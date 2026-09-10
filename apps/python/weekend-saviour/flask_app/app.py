import os
import sys
import threading
from flask import Flask, request, jsonify

# Add parent directory to python path for service imports
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.error_queue_worker import enqueue_error_payload, process_error_queue
from services.resolution_queue_worker import enqueue_resolution, process_resolution_queue

app = Flask(__name__)

# Start background queue worker threads
def start_background_workers():
    error_thread = threading.Thread(target=process_error_queue, args=(enqueue_resolution,), daemon=True)
    error_thread.start()
    
    resolution_thread = threading.Thread(target=process_resolution_queue, daemon=True)
    resolution_thread.start()

start_background_workers()

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        "status": "ONLINE",
        "service": "Call-E Autonomous Incident Remediation Server",
        "error_queue": "RUNNING",
        "resolution_queue": "RUNNING"
    }), 200

@app.route('/api/airflow-failure-webhook', methods=['POST'])
def airflow_failure_webhook():
    """
    Flask HTTP Webhook Endpoint for Airflow on_failure_callback.
    Enqueues failure payload onto Error Queue and returns immediately.
    """
    payload = request.get_json(force=True)
    print("\n" + "#"*75)
    print("⚡ [FLASK INCIDENT SERVER] Received Airflow DAG Failure Webhook")
    print("#"*75)
    print(f"DAG ID: {payload.get('dag_id')}")
    print(f"Task ID: {payload.get('task_id')}")
    print(f"Execution Date: {payload.get('execution_date')}")
    print(f"Error Message: {payload.get('error_message')}")
    print("#"*75 + "\n")

    incident_id = enqueue_error_payload(payload)

    return jsonify({
        "status": "QUEUED",
        "incident_id": incident_id,
        "dag_id": payload.get('dag_id'),
        "task_id": payload.get('task_id'),
        "message": "Incident payload pushed to Error Queue for processing."
    }), 202

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 7071))
    print(f"🚀 Starting Flask Incident Remediation Server on http://0.0.0.0:{port}/api/airflow-failure-webhook")
    app.run(host='0.0.0.0', port=port, debug=False)
