const form = document.getElementById("reminderForm");
const button = document.getElementById("callButton");
const status = document.getElementById("callStatus");
const result = document.getElementById("result");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  button.disabled = true;
  button.innerHTML = "Calling...";
  status.textContent = "CALL-E is handling the conversation...";

  result.innerHTML = `
    <div class="empty">
      <div></div>
      <p>The Agent is currently making the call.</p>
      <p>Please wait...</p>
    </div>
  `;

  const data = {
    parentName: document.getElementById("parentName").value,
    studentName: document.getElementById("studentName").value,
    phoneNumber: document.getElementById("phoneNumber").value,
    amount: document.getElementById("amount").value,
    dueDate: document.getElementById("dueDate").value,
    schoolName: document.getElementById("schoolName").value,
  };

  try {

    const response = await fetch("/api/reminder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    const call = await response.json();

    if (!response.ok) {
      throw new Error(call.error);
    }

    status.textContent = "Call completed";

    const r = call.structuredResult || {};

    result.innerHTML = `
      <div class="result">

        <div class="result-item">
          <small>Payment awareness</small>
          <strong>${r.payment_awareness || "Unknown"}</strong>
        </div>

        <div class="result-item">
          <small>Will pay?</small>
          <strong>${r.will_pay || "Unknown"}</strong>
        </div>

        <div class="result-item">
          <small>Expected payment date</small>
          <strong>${r.payment_date || "Not provided"}</strong>
        </div>

        <div class="result-item">
          <small>AI confidence</small>
          <strong>${call.completionConfidence ?? "N/A"}</strong>
        </div>

        <div class="result-item">
          <small>Call status</small>
          <strong>${call.status}</strong>
        </div>

        <div class="result-item">
          <small>Task completed</small>
          <strong>${call.taskCompleted ? "Yes" : "No"}</strong>
        </div>

      </div>
    `;

  } catch (error) {

    status.textContent = "Call failed";

    result.innerHTML = `
      <div class="error">
        <strong>Something went wrong</strong>
        <p>${error.message}</p>
      </div>
    `;

  } finally {

    button.disabled = false;
    button.innerHTML = "Start Reminder Call";

  }
});