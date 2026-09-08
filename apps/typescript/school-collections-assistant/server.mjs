import "dotenv/config";
import express from "express";
import { CalleClient } from "@call-e/calle";

const app = express();
const PORT = 3001;

const client = new CalleClient({
  apiKey: process.env.CALLE_LIVE_API_KEY,
});

app.use(express.json());
app.use(express.static("public"));

app.post("/api/reminder", async (req, res) => {
  try {
    const {
      parentName,
      studentName,
      phoneNumber,
      amount,
      dueDate,
      schoolName,
    } = req.body;

    if (!parentName || !studentName || !phoneNumber || !amount || !dueDate) {
      return res.status(400).json({
        error: "Please provide all required fields.",
      });
    }

    const call = await client.calls.createAndWait({
      task: `
You are a polite school payment reminder assistant calling on behalf of ${
        schoolName || "the school"
      }.

You are speaking with ${parentName}, the parent or guardian of ${studentName}.

The student's outstanding school payment is ${amount}.
The payment is due on ${dueDate}.

Your task is to:
1. Politely introduce yourself as calling on behalf of the school.
2. Inform the parent about the outstanding payment.
3. Ask whether they are aware of the outstanding balance.
4. Ask when they expect to make the payment.
5. Be polite and understanding.
6. Do not pressure, threaten, or embarrass the parent.
7. Thank them for their time.

If the parent cannot commit to a date, record that appropriately.

Do not make up information that was not provided.
      `,
      recipient: {
        phone: phoneNumber,
      },
      resultSchema: {
        type: "object",
        required: [
          "payment_awareness",
          "will_pay",
          "payment_date",
        ],
        properties: {
          payment_awareness: {
            type: "string",
            enum: ["yes", "no", "unknown"],
          },
          will_pay: {
            type: "string",
            enum: ["yes", "no", "uncertain"],
          },
          payment_date: {
            type: "string",
          },
          parent_response: {
            type: "string",
          },
        },
      },
    });

    res.json({
      success: true,
      status: call.status,
      taskCompleted: call.taskCompleted,
      completionConfidence: call.completionConfidence,
      structuredResult: call.structuredResult,
      evidence: call.evidence,
    });
  } catch (error) {
    console.error(error);

    res.status(error.status || 500).json({
      success: false,
      error: error.message || "Something went wrong.",
    });
  }
});

export { app };

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(
      `School Payment Assistant running at http://localhost:${PORT}`
    );
  });
}