"""
Top-level app entrypoint forwarder
"""
from bytelytic_clinic.server import app
from bytelytic_clinic.cli import main as cli_main

if __name__ == "__main__":
    cli_main()
