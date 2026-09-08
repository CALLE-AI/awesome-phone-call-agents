import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../server.mjs";

describe("POST /api/reminder", () => {
  it("rejects requests with missing required fields", async () => {
    const response = await request(app)
      .post("/api/reminder")
      .send({
        parentName: "John Banda",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      "Please provide all required fields."
    );
  });

  it("rejects requests without a student name", async () => {
    const response = await request(app)
      .post("/api/reminder")
      .send({
        parentName: "John Banda",
        phoneNumber: "+12025550100",
        amount: "K2,500",
        dueDate: "2026-09-30",
      });

    expect(response.status).toBe(400);
  });

  it("rejects requests without a phone number", async () => {
    const response = await request(app)
      .post("/api/reminder")
      .send({
        parentName: "John Banda",
        studentName: "Mary Banda",
        amount: "K2,500",
        dueDate: "2026-09-30",
      });

    expect(response.status).toBe(400);
  });

  it("rejects requests without an amount", async () => {
    const response = await request(app)
      .post("/api/reminder")
      .send({
        parentName: "John Banda",
        studentName: "Mary Banda",
        phoneNumber: "+12025550100",
        dueDate: "2026-09-30",
      });

    expect(response.status).toBe(400);
  });

  it("rejects requests without a due date", async () => {
    const response = await request(app)
      .post("/api/reminder")
      .send({
        parentName: "John Banda",
        studentName: "Mary Banda",
        phoneNumber: "+12025550100",
        amount: "K2,500",
      });

    expect(response.status).toBe(400);
  });
});