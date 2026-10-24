const express = require("express");
const cors = require("cors");
require("dotenv").config();

const apiRoutes = require("./routes");
const { errorHandler } = require("./middleware/errorHandler");

const app = express();

// Standard middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Mount all CURA API routes
app.use("/api", apiRoutes);

// Fallback for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `Endpoint '${req.method} ${req.originalUrl}' does not exist.`
    }
  });
});

// Centralized error handler
app.use(errorHandler);

module.exports = app;