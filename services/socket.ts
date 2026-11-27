import { io } from "socket.io-client";
import { SERVER_URL } from "./auth";

// Call connectSocket(token) instead of socket.connect(): the server
// rejects connections that don't carry a valid JWT.
export const socket = io(SERVER_URL, {
  autoConnect: false,
});

export function connectSocket(token: string) {
  socket.auth = { token };
  socket.connect();
}
