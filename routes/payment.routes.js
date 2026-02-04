const express = require("express");
const Stripe = require("stripe");
const Loan = require("../models/Loan"); // তোমার loan model path ঠিক করিস

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// 🟢 Admin → User টাকা পাঠানোর Checkout
router.post("/admin/send/:loanId", async (req, res) => {
  const loan = await Loan.findById(req.params.loanId);

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `Loan Disbursement - ${loan.fullName}`,
          },
          unit_amount: loan.loanAmount * 100,
        },
        quantity: 1,
      },
    ],
    success_url: "http://localhost:5173/admin/success",
    cancel_url: "http://localhost:5173/admin/cancel",
  });

  res.json({ url: session.url });
});

// 🟣 User → Loan Repayment Checkout
router.post("/user/repay/:loanId", async (req, res) => {
  const loan = await Loan.findById(req.params.loanId);

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `Loan Repayment - ${loan.fullName}`,
          },
          unit_amount: loan.repayAmount * 100,
        },
        quantity: 1,
      },
    ],
    success_url: "http://localhost:5173/borrower/success",
    cancel_url: "http://localhost:5173/borrower/cancel",
  });

  res.json({ url: session.url });
});

module.exports = router;
