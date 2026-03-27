import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;

  // In-memory store for users and their codes
  // { socketId: { code, name } }
  const users = new Map();
  // { code: socketId }
  const codeToSocket = new Map();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("register", ({ code, name }) => {
      users.set(socket.id, { code, name });
      codeToSocket.set(code, socket.id);
      console.log(`User registered: ${name} with code ${code}`);
    });

    socket.on("send-message", ({ toCode, message, fromCode, fromName }) => {
      const targetSocketId = codeToSocket.get(toCode);
      if (targetSocketId) {
        io.to(targetSocketId).emit("receive-message", {
          fromCode,
          fromName,
          message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    socket.on("call-user", ({ toCode, fromCode, fromName, signal }) => {
      const targetSocketId = codeToSocket.get(toCode);
      if (targetSocketId) {
        io.to(targetSocketId).emit("incoming-call", {
          fromCode,
          fromName,
          signal,
        });
      }
    });

    socket.on("answer-call", ({ toCode, signal }) => {
      const targetSocketId = codeToSocket.get(toCode);
      if (targetSocketId) {
        io.to(targetSocketId).emit("call-accepted", { signal });
      }
    });

    socket.on("disconnect", () => {
      const user = users.get(socket.id);
      if (user) {
        codeToSocket.delete(user.code);
        users.delete(socket.id);
      }
      console.log("User disconnected:", socket.id);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
