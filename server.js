import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import {
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    collection,
    getDocs,
} from "firebase/firestore";
import { db } from "./firebase-config.js";
import { v4 as uuidv4 } from "uuid";
import { setInterval } from "timers";

// Initialize Express app
const app = express();
app.use(
    cors({
        origin: "*", // Adjust for production to specific frontend URL
    })
);
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
    cors: {
        origin: "*", // Adjust for production
        methods: ["GET", "POST"],
    },
});

// ... (previous imports and setup remain unchanged)

// Socket.IO connection handling
io.on("connection", (socket) => {
    console.log("✅ User connected:", socket.id);

    socket.on("join-room", async (roomId) => {
        try {
            socket.join(roomId);
            console.log(`User ${socket.id} joined room: ${roomId}`);

            // Fetch code from Firestore
            const docRef = doc(db, "codes", roomId);
            const docSnap = await getDoc(docRef);
            const code = docSnap.exists() ? docSnap.data().code : "";

            // Update last accessed time only if lastAccessedAt exists
            if (docSnap.exists() && docSnap.data().lastAccessedAt) {
                await setDoc(
                    docRef,
                    { lastAccessedAt: new Date().toISOString() },
                    { merge: true }
                );
            }

            // Emit the loaded code to the client
            socket.emit("load-code", code);

            // Notify others in the room about the new user for WebRTC
            socket.to(roomId).emit("user-connected", socket.id);
        } catch (error) {
            console.error("Error joining room:", error);
            socket.emit("error", "Failed to join room");
        }
    });

    socket.on("code-change", async ({ roomId, code }) => {
        try {
            // Fetch document to check if lastAccessedAt exists
            const docRef = doc(db, "codes", roomId);
            const docSnap = await getDoc(docRef);

            // Prepare update data
            const updateData = { code };
            if (docSnap.exists() && docSnap.data().lastAccessedAt) {
                updateData.lastAccessedAt = new Date().toISOString();
            } else if (!docSnap.exists()) {
                updateData.lastAccessedAt = new Date().toISOString();
            }

            // Save code to Firestore
            await setDoc(docRef, updateData, { merge: true });

            // Broadcast code change to other clients in the room
            socket.to(roomId).emit("code-change", code);
        } catch (error) {
            console.error("Error saving code:", error);
            socket.emit("error", "Failed to save code");
        }
    });

    // WebRTC signaling events
    socket.on("offer", ({ roomId, offer, to }) => {
        socket.to(to).emit("offer", { offer, from: socket.id });
    });

    socket.on("answer", ({ roomId, answer, to }) => {
        socket.to(to).emit("answer", { answer, from: socket.id });
    });

    socket.on("ice-candidate", ({ roomId, candidate, to }) => {
        socket.to(to).emit("ice-candidate", { candidate, from: socket.id });
    });

    socket.on("disconnect", () => {
        console.log("❌ User disconnected:", socket.id);
        // Notify others in the room about disconnection
        socket.rooms.forEach((room) => {
            if (room !== socket.id) {
                // Exclude the default room (socket.id)
                socket.to(room).emit("user-disconnected", socket.id);
            }
        });
    });
});

// REST routes
app.get("/api/code/:roomId", async (req, res) => {
    try {
        const roomId = req.params.roomId;
        const docRef = doc(db, "codes", roomId);
        const docSnap = await getDoc(docRef);
        const code = docSnap.exists() ? docSnap.data().code : "";

        // Update last accessed time only if lastAccessedAt exists
        if (docSnap.exists() && docSnap.data().lastAccessedAt) {
            await setDoc(
                docRef,
                { lastAccessedAt: new Date().toISOString() },
                { merge: true }
            );
        }

        res.json({ code });
    } catch (error) {
        console.error("Error fetching code:", error);
        res.status(500).json({ error: "Failed to fetch code" });
    }
});

app.post("/api/code/:roomId", async (req, res) => {
    try {
        const roomId = req.params.roomId;
        const { code } = req.body;

        // Fetch document to check if lastAccessedAt exists
        const docRef = doc(db, "codes", roomId);
        const docSnap = await getDoc(docRef);

        // Prepare update data
        const updateData = { code };
        if (docSnap.exists() && docSnap.data().lastAccessedAt) {
            updateData.lastAccessedAt = new Date().toISOString();
        } else if (!docSnap.exists()) {
            // New document, add lastAccessedAt
            updateData.lastAccessedAt = new Date().toISOString();
        }

        await setDoc(docRef, updateData, { merge: true });
        res.json({ message: "Code saved successfully" });
    } catch (error) {
        console.error("Error saving code:", error);
        res.status(500).json({ error: "Failed to save code" });
    }
});

app.get("/api/keep-alive", async (req, res) => {
    try {
        console.log("request accepted on keep-alive");

        // Check for expired documents with empty or whitespace-only code
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const codesCollection = collection(db, "codes");
        const snapshot = await getDocs(codesCollection);

        const deletePromises = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            // Only consider documents with lastAccessedAt
            if (data.lastAccessedAt) {
                const lastAccessed = new Date(data.lastAccessedAt);
                const isCodeEmpty = !data.code || data.code.trim() === "";
                // Delete if older than 30 days AND code is empty/only whitespace
                if (lastAccessed < thirtyDaysAgo || isCodeEmpty) {
                    console.log(
                        `Deleting expired and empty document: ${docSnap.id}`
                    );
                    deletePromises.push(
                        deleteDoc(doc(db, "codes", docSnap.id))
                    );
                }
            }
        });

        await Promise.all(deletePromises);
        console.log(`Deleted ${deletePromises.length} documents`);

        res.json({
            message: "Server is alive",
            deletedCount: deletePromises.length,
        });
    } catch (error) {
        console.error("Error in keep-alive:", error);
        res.status(500).json({
            message: "Server is alive but error in cleanup",
            error: error.message,
        });
    }
});

// Generate a new random route
app.get("/api/new", (req, res) => {
    const roomId = uuidv4();
    res.json({ roomId });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
