import crypto from "crypto";

const JAZZCASH_CONFIG = {
  merchantId: process.env.JAZZCASH_MERCHANT_ID ?? "MCH123",
  password:   process.env.JAZZCASH_PASSWORD    ?? "test_password",
  salt:       process.env.JAZZCASH_INTEGRITY_SALT ?? "test_salt",
  sandbox:    process.env.NODE_ENV !== "production",
  get apiUrl() {
    return process.env.NODE_ENV === "production"
      ? "https://payments.jazzcash.com.pk"
      : "https://sandbox.jazzcash.com.pk";
  },
};

export interface JazzCashPaymentInput {
  amount:       number; // PKR, whole number (no decimals)
  orderId:      string; // unique order reference, max 20 chars
  description:  string; // max 100 chars
  returnUrl:    string; // absolute URL
  mobileNumber: string; // 03XXXXXXXXX format
}

export interface JazzCashFormData {
  formAction: string;
  fields: Record<string, string>;
}

/**
 * Generates the signed form fields for a JazzCash MPAY (mobile wallet) transaction.
 * The caller renders a hidden HTML form auto-submitted to formAction.
 * JazzCash redirects the customer back to returnUrl with result params.
 */
export function createJazzCashPayment(input: JazzCashPaymentInput): JazzCashFormData {
  const { amount, orderId, description, returnUrl, mobileNumber } = input;

  // txnDateTime: YYYYMMDDHHmmss
  const txnDateTime = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .substring(0, 14);

  const txnRefNo = `T${txnDateTime}${orderId.substring(0, 6).toUpperCase()}`;
  const amountPaisa = String(amount * 100); // JazzCash uses paisa

  // Pipe-delimited hash string per JazzCash MPAY API v1.1 documentation
  const hashParts = [
    JAZZCASH_CONFIG.salt,
    txnDateTime,
    "1",          // txnCurrency code: 1 = PKR
    amountPaisa,
    "",           // billingAddressState
    "",           // billingAddressCity
    "",           // billingAddressZip
    "",           // billingAddressCountry
    "",           // billingAddressEmail
    mobileNumber,
    JAZZCASH_CONFIG.merchantId,
    orderId,
    JAZZCASH_CONFIG.password,
    "",           // productId
    "00",         // txnType: 00 = MPAY
    txnRefNo,
    returnUrl,
  ];

  const hashStr = hashParts.join("&");

  const secureHash = crypto
    .createHmac("sha256", JAZZCASH_CONFIG.salt)
    .update(hashStr)
    .digest("hex")
    .toUpperCase();

  return {
    formAction: `${JAZZCASH_CONFIG.apiUrl}/CustomerPortal/transactionmanagement/merchantform`,
    fields: {
      pp_Version:           "1.1",
      pp_TxnType:           "MPAY",
      pp_Language:          "EN",
      pp_MerchantID:        JAZZCASH_CONFIG.merchantId,
      pp_SubMerchantID:     "",
      pp_Password:          JAZZCASH_CONFIG.password,
      pp_BankID:            "TBANK",
      pp_ProductID:         "RETL",
      pp_TxnRefNo:          txnRefNo,
      pp_Amount:            amountPaisa,
      pp_TxnCurrency:       "PKR",
      pp_TxnDateTime:       txnDateTime,
      pp_BillReference:     orderId,
      pp_Description:       description.substring(0, 100),
      pp_TxnExpiryDateTime: "",
      pp_SecureHash:        secureHash,
      ppmpf_1:              mobileNumber,
      pp_ReturnURL:         returnUrl,
    },
  };
}

/**
 * Verifies the callback hash from JazzCash after payment redirect.
 * Call this in your webhook/return-url handler to confirm payment authenticity.
 */
export function verifyJazzCashCallback(params: Record<string, string>): boolean {
  const receivedHash = params.pp_SecureHash;
  if (!receivedHash) return false;

  // Rebuild hash from all pp_ params except pp_SecureHash, sorted alphabetically
  const hashParts = Object.entries(params)
    .filter(([k]) => k !== "pp_SecureHash" && k.startsWith("pp_"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);

  const hashStr = [JAZZCASH_CONFIG.salt, ...hashParts].join("&");

  const expectedHash = crypto
    .createHmac("sha256", JAZZCASH_CONFIG.salt)
    .update(hashStr)
    .digest("hex")
    .toUpperCase();

  return expectedHash === receivedHash;
}

/** JazzCash response codes that indicate a successful payment */
export const JAZZCASH_SUCCESS_CODES = new Set(["000", "00"]);
