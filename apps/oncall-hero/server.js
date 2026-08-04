import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { makeBookingCall } from "./services/calleService.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// In-Memory Call History Store
const callHistory = [];

// API Endpoint: Trigger an Appointment Call
app.post("/api/calls/book", async (req, res) => {
  const { providerName, phoneNumber, customerName, desiredTime, notes, serviceName } = req.body;

  if (!providerName || !phoneNumber || !customerName || !desiredTime || !serviceName) {
    return res.status(400).json({
      error: "Missing required fields: providerName, phoneNumber, customerName, desiredTime, serviceName",
    });
  }

  try {
    const result = await makeBookingCall({
      providerName,
      phoneNumber,
      customerName,
      serviceName,
      desiredTime,
      notes,
    });

    callHistory.unshift(result);

    return res.status(200).json({
      message: "Call completed successfully",
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "An error occurred while placing the call.",
    });
  }
});

// API Endpoint: Get Call Logs
app.get("/api/calls", (req, res) => {
  res.json({
    totalCalls: callHistory.length,
    calls: callHistory,
  });
});

// API Endpoint: Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "OnCall Hero API" });
});

app.listen(PORT, () => {
  console.log(`\n🚀 OnCall Hero Server running at http://localhost:${PORT}`);
  console.log(`📊 Web Dashboard available at http://localhost:${PORT}\n`);
});