# Development Decisions

- Start with a Vite React and TypeScript frontend.
- Keep CALL-E credentials and phone-number handling out of the browser.
- Defer database, accounts, payments, and third-party voice tooling until justified by the MVP.
- The PageLoader is a visual-only temporal communications introduction; it does not indicate an active or verified CALL-E connection.
- The first navigable MVP is a mock time-critical shipment readiness check. Its futuristic shell supports a practical operations workflow; mock status, duration, and report values do not represent live calls, tracking, or predictions.
- The Overview uses a typed mock operations queue to communicate future multi-check capacity without implying that sample rows have real calls or workflows. SH-2048 remains the only interactive prototype.
- The call monitor is a reusable modal operations view with typed prototype stages. It monitors a fictional call lifecycle but does not control recipient phone audio or imply CALL-E integration.
