# Sourcy — AI Procurement Agent

**Sourcy is an autonomous AI procurement agent that calls suppliers, speaks with them over the phone, collects live quotes, analyzes their responses, and recommends the best supplier for the buyer's specific procurement situation.**

Instead of making the buyer manually call multiple suppliers and compare their answers, Sourcy does the communication and analysis for them.

### How Sourcy works

```text
Buyer submits procurement request
              ↓
        Sourcy AI Agent
              ↓
     AI calls suppliers
              ↓
   AI speaks with suppliers
              ↓
 Collects availability, price,
 delivery, stock & discounts
              ↓
     Compares suppliers
              ↓
   Evaluates budget, urgency
       & supplier risk
              ↓
 Recommends the best supplier
              ↓
 Explains WHY it was chosen
```

## Why Sourcy?

Procurement is often more complicated than finding the cheapest supplier.

A supplier may offer a low price but have insufficient stock, slow delivery, or higher risk. Sourcy evaluates the **entire procurement situation** before making its recommendation.

For example, an urgent order may require Sourcy to prioritize a supplier that can deliver quickly, while a flexible order may place more emphasis on total cost.

## 🤖 Autonomous AI Supplier Calling

The core of Sourcy is its ability to **communicate with suppliers by phone using AI**.

Sourcy can:

1. Receive a procurement request from a buyer.
2. Identify suppliers to contact.
3. Automatically call suppliers.
4. Speak with suppliers through the phone call.
5. Ask structured procurement questions.
6. Collect the supplier's responses.
7. Extract the information from the conversation.
8. Compare the supplier against other quotes.
9. Evaluate the procurement situation.
10. Recommend the best supplier.

The buyer does not need to manually call each supplier.

### What the AI asks suppliers

During supplier calls, Sourcy can collect information such as:

* Product availability
* Quantity available
* Unit price
* Delivery availability
* Delivery cost
* Delivery time
* Bulk discounts

This turns an unstructured phone conversation into structured procurement data.

## 📞 CALL-E Integration

Sourcy uses **CALL-E** to give its AI agent the ability to make real phone calls and communicate with suppliers.

CALL-E is not simply displayed as an integration or mentioned in the interface. Sourcy uses the CALL-E SDK at runtime to initiate supplier calls and process the resulting call information.

This allows Sourcy to bridge the gap between:

**AI decision-making ↔ real-world phone communication.**

## 🧠 Context-Aware Supplier Intelligence

Sourcy does not simply ask:

> "Which supplier is cheapest?"

Instead, it asks:

> **"Which supplier is best for THIS procurement situation?"**

The decision engine considers:

* Product availability
* Stock sufficiency
* Total procurement cost
* Delivery availability
* Delivery speed
* Procurement budget
* Order urgency
* Bulk discounts
* Supplier risk
* Supplier performance

## 💰 Budget Awareness

Sourcy evaluates whether supplier quotes fit within the buyer's procurement budget.

The system distinguishes between:

* Suppliers within budget
* Suppliers slightly above budget
* Suppliers significantly above budget

Budget fit becomes part of the supplier's overall decision score.

## ⚡ Urgency Awareness

The recommendation changes depending on how urgent the procurement request is.

For urgent requests, Sourcy gives greater importance to suppliers that can deliver quickly.

For normal procurement, the system balances cost, stock, delivery, and other factors.

For flexible procurement, cost efficiency can receive greater weight.

## 🛡️ Supplier Risk Detection

Sourcy evaluates supplier risk as part of the procurement decision.

Potential supplier concerns are surfaced alongside the recommendation so that the buyer can understand not only **which supplier was selected**, but also **what risks were considered**.

## 🏆 Transparent Recommendations

Sourcy does not simply return a supplier name.

It explains why the supplier was selected, including factors such as:

* Budget fit
* Delivery speed
* Stock sufficiency
* Cost position
* Bulk discount
* Supplier risk

This makes the AI decision easier for a buyer to understand and evaluate.

## 📊 Procurement Intelligence

Sourcy keeps a session-based procurement history and provides insights into previous procurement decisions and supplier performance.

The system can show:

* Previous procurement requests
* Recommended suppliers
* Supplier scores
* Procurement costs
* Delivery information
* Supplier risk
* Decision factors

## 🧪 Demo Mode

Sourcy includes a **Demo Mode** using sample supplier data.

Demo Mode allows the complete procurement decision workflow to be tested without making real phone calls or consuming CALL-E call credits.

This is useful for:

* Demonstrations
* Development
* Testing
* Hackathon evaluation

## 📞 Live Mode

Sourcy also supports **Live Mode**, where the AI agent can call a real supplier using CALL-E.

A valid `CALLE_API_KEY` is required for live calls.

Set the environment variable before running the application:

```powershell
$env:CALLE_API_KEY="your_api_key_here"
```

**Never commit API keys or other secrets to the repository.**

## 🏗️ Tech Stack

* Python
* Streamlit
* CALL-E
* AI agent workflow
* Supplier phone calls
* Supplier quote extraction
* Supplier scoring
* Risk analysis
* Context-aware procurement recommendations

## 📁 Project Structure

```text
Sourcy/
├── app.py
├── app/
│   ├── __init__.py
│   ├── agent.py
│   ├── main.py
│   └── suppliers.py
├── tests/
│   ├── test_call.py
│   ├── test_extractor.py
│   ├── test_full_flow.py
│   ├── test_multiple_suppliers.py
│   └── test_recommendation.py
├── test_decisions.py
├── test_full_agent.py
├── test_supplier_call.py
├── .gitignore
└── README.md
```

## 🚀 Running Sourcy Locally

Clone the repository:

```powershell
git clone https://github.com/uzochichinedu79-alt/Sourcy.git
cd Sourcy
```

Create a virtual environment:

```powershell
python -m venv .venv
```

Activate it:

```powershell
.venv\Scripts\Activate.ps1
```

Install dependencies:

```powershell
pip install streamlit calle-ai
```

Run the application:

```powershell
python -m streamlit run app.py
```

## 💡 Example Procurement Request

A buyer submits:

```text
Product: Cement
Quantity: 200
Location: Abuja
Budget: ₦5,000,000
Urgency: Urgent
```

Sourcy's AI agent contacts suppliers and collects their responses.

It then evaluates:

1. Available stock
2. Total cost
3. Delivery speed
4. Budget fit
5. Supplier risk
6. Procurement urgency

The system produces a ranked supplier list and recommends the supplier that best matches the buyer's situation.

For example, a supplier with a slightly higher price may still win if it has the required stock and significantly faster delivery for an urgent order.

## 🧪 Testing

The project includes tests covering:

* Supplier calls
* Quote extraction
* Supplier comparison
* Recommendation logic
* Multiple supplier scenarios
* Full procurement flows
* Decision scoring

Demo Mode allows the core procurement workflow to be tested without making real supplier calls.

## 🏆 CALL-E Hackathon

Sourcy was built for the **CALL-E: Your Code Is Calling** hackathon.

The project explores how AI phone agents can move beyond simple conversations and perform useful real-world business work.

Sourcy's AI agent can **actually call suppliers, communicate with them, collect procurement information, reason over the results, and make a purchasing recommendation.**

The goal is to reduce the manual work involved in supplier sourcing while making procurement decisions faster, more transparent, and more context-aware.

## 🔮 Future Improvements

Potential future improvements include:

* Persistent procurement history
* Larger supplier networks
* Supplier verification
* Automated purchase orders
* Inventory system integrations
* Real-time supplier databases
* Procurement forecasting
* Multi-location procurement optimization
* Automated supplier follow-ups


