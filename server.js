// -------------------- IMPORTS --------------------
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// -------------------- APP SETUP --------------------
const app = express();
app.use(cors());
app.use(express.json());

// -------------------- LOAD & FIX CREDENTIALS --------------------
const CRED_PATH = path.join(__dirname, "credentials.json");

// Check file exists
if (!fs.existsSync(CRED_PATH)) {
  console.error("❌ ERROR: credentials.json is missing!");
  process.exit(1);
}

// Read as raw text (Windows safe)
let raw = fs.readFileSync(CRED_PATH, "utf8");

// Fix CRLF issues
raw = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

// Parse JSON
const credentials = JSON.parse(raw);

// Clean private key STRICTLY
let privateKey = credentials.private_key
  .replace(/\\n/g, "\n")
  .replace(/\\\\n/g, "\n")
  .trim();

// Debug check
console.log("🔑 PRIVATE KEY CHECK:", privateKey.includes("BEGIN PRIVATE KEY") ? "OK" : "BROKEN");
console.log("PRIVATE KEY LENGTH:", privateKey.length);
console.log("FIRST 50 CHARS:", privateKey.slice(0, 50));
console.log("LAST 50 CHARS:", privateKey.slice(-50));

// -------------------- GOOGLE SHEETS AUTH --------------------
const client = new google.auth.JWT(
  credentials.client_email,
  undefined,
  privateKey,
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth: client });

// Connect Google Sheets
client.authorize((err) => {
  if (err) {
    console.error("❌ Google API Auth Error:", err);
    process.exit(1);
  }
  console.log("✅ Google Sheets Authenticated");
});

// -------------------- NODEMAILER SETUP --------------------
const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER, // from .env
    pass: process.env.EMAIL_PASS
  }
});

// Verify SMTP
transporter.verify((err) => {
  if (err) {
    console.error("❌ SMTP Error:", err);
  } else {
    console.log("✅ SMTP Ready");
  }
});

// -------------------- API ENDPOINT --------------------
app.post("/submit-form", async (req, res) => {
  console.log("🔥 New Form Submitted:", req.body);

  const { name, email, phone, service, message } = req.body;

  const row = [
    name,
    email,
    phone || "",
    service,
    message,
    new Date().toLocaleString()
  ];

  try {
    // Write to Google Sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: "Sheet1!A:F",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] }
    });

    console.log("📄 Added to Google Sheet");

    // Send Notification Email
    await transporter.sendMail({
      from: `"Punjab Immigration" <${process.env.EMAIL_USER}>`,
      to: process.env.NOTIFICATION_EMAIL,
      subject: "New Website Lead!",
      html: `
        <h2>New Lead From Website</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone || "Not provided"}</p>
        <p><strong>Service:</strong> ${service}</p>
        <p><strong>Message:</strong> ${message}</p>
      `
    });

    console.log("📧 Notification email sent");

    res.json({ success: true, message: "Thank you! Your message has been sent." });

  } catch (err) {
    console.error("❌ Error in submit-form:", err);

    if (err.response?.data) {
      console.error("➡ Google API:", err.response.data);
    }

    res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
      error: err.message
    });
  }
});

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Backend running at http://localhost:${PORT}`));
