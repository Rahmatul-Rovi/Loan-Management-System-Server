const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ================= JWT =================
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  const token = authHeader.split(" ")[1];
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.user = decoded;
    next();
  });
};

// ================= MongoDB =================
const uri = `mongodb+srv://${process.env.MONGO_USERNAME}:${process.env.MONGO_PASSWORD}@cluster0.bou0ahg.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let loansCollection;
let applicationsCollection;
let usersCollection;
let db;


/**
 * DATABASE CONNECTION MIDDLEWARE
 * Essential for Vercel Serverless environment.
 */
async function connectDB(req, res, next) {
  try {
    if (!db) {
      await client.connect();
      // CHANGED: Database name set to 'test'
      db = client.db("test");
      loansCollection = db.collection("Loans");
      applicationsCollection = db.collection("Applications");
      usersCollection = db.collection("Users");
      console.log("✅ MongoDB Connected to database: test");
    }
    next();
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
    res
      .status(500)
      .send({ message: "Internal Server Error: Database Connection Failed" });
  }
}

// Apply the connection check to every request
app.use(connectDB);

app.get("/", (req, res) => {
  res.send("🚀 Server Running (Test DB)");
});

// Approve + Disburse (Admin)
app.patch("/applications/approve/:id", async (req, res) => {
  const { repayAmount, deadline } = req.body;

  await applications.updateOne(
    { _id: new ObjectId(req.params.id) },
    {
      $set: {
        status: "disbursed",
        repayAmount,
        deadline,
        repayStatus: "unpaid",
        disbursedAt: new Date()
      }
    }
  );

  res.send({ success: true });
});

app.patch("/applications/reject/:id", async (req, res) => {
  await applications.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status: "rejected" } }
  );
  res.send({ success: true });
});


// Create Stripe Payment Intent (User repay)
// Create Stripe Payment Intent (User repay)
app.post("/create-payment-intent", async (req, res) => {
  // CHANGED: 'price' এর বদলে 'amount' রিসিভ করো কারণ ফ্রন্টএন্ড থেকে এটাই পাঠাচ্ছ
  const { amount } = req.body;

  if (!amount || isNaN(amount)) {
    return res.status(400).send({ message: "Invalid amount provided" });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // সেন্টে কনভার্ট (রাউন্ড ফিগার রাখা ভালো)
      currency: "usd",
      payment_method_types: ["card"]
    });

    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("Stripe Error:", error.message);
    res.status(500).send({ error: error.message });
  }
});

// Mark repaid
app.patch("/applications/repay/:id", async (req, res) => {
  await applications.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { repayStatus: "paid" } }
  );
  res.send({ success: true });
});


// =================================================
// AUTH
// =================================================

app.post("/register", async (req, res) => {
  const { name, email, password, role, photoURL } = req.body;

  if (!name || !email || !password) {
    return res.status(400).send({ message: "Missing fields" });
  }

  const existingUser = await usersCollection.findOne({ email });
  if (existingUser) {
    return res.status(400).send({ message: "User already exists" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const result = await usersCollection.insertOne({
    name,
    email,
    password: hashedPassword,
    role: role || "borrower",
    photoURL,
    createdAt: new Date(),
  });

  res.send({ userId: result.insertedId });
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  // ---------------- Admin ----------------
  if (
    email === process.env.ADMIN_EMAIL &&
    password === process.env.ADMIN_PASSWORD
  ) {
    const token = jwt.sign({ email, role: "admin" }, JWT_SECRET, {
      expiresIn: "1h",
    });
    return res.send({ email, role: "admin", token });
  }

  const user = await usersCollection.findOne({ email });
  if (!user) return res.status(400).send({ message: "Invalid credentials" });

  if (user.role.toLowerCase() === "suspended") {
    return res.status(403).send({ message: "Your account is suspended" });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).send({ message: "Invalid credentials" });

  const token = jwt.sign(
    { email: user.email, role: user.role, id: user._id },
    JWT_SECRET,
    { expiresIn: "1h" },
  );

  res.send({
    name: user.name,
    email: user.email,
    role: user.role,
    photoURL: user.photoURL,
    token,
  });
});

// ================= GET USER BY EMAIL =================
app.get("/users/by-email", async (req, res) => {
  const email = req.query.email?.trim();
  if (!email) return res.status(400).send({ message: "Email is required" });

  try {
    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).send({ message: "User not found" });

    res.send([user]);
  } catch (err) {
    console.error("Error fetching user by email:", err);
    res.status(500).send({ message: "Server error" });
  }
});

// =================================================
// LOANS
// =================================================

app.get("/loans", async (req, res) => {
  const loans = await loansCollection.find().toArray();
  res.send(loans);
});

app.get("/loans/:id", async (req, res) => {
  try {
    const loan = await loansCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    res.send(loan);
  } catch (err) {
    res.status(400).send({ message: "Invalid loan ID" });
  }
});

app.post("/loans", async (req, res) => {
  try {
    const loanData = { ...req.body, createdAt: new Date() };
    const result = await loansCollection.insertOne(loanData);
    res.send({ message: "Loan added successfully", loanId: result.insertedId });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to add loan" });
  }
});

app.patch("/loans/:id", async (req, res) => {
  try {
    const loanId = req.params.id;
    const updateData = { ...req.body, updatedAt: new Date() };

    const result = await loansCollection.updateOne(
      { _id: new ObjectId(loanId) },
      { $set: updateData },
    );

    if (result.matchedCount === 0)
      return res.status(404).send({ message: "Loan not found" });

    res.send({ message: "Loan updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to update loan" });
  }
});

app.delete("/loans/:id", async (req, res) => {
  try {
    const loanId = req.params.id;
    const result = await loansCollection.deleteOne({
      _id: new ObjectId(loanId),
    });

    if (result.deletedCount === 0)
      return res.status(404).send({ message: "Loan not found" });

    res.send({ message: "Loan deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to delete loan" });
  }
});

// =================================================
// APPLICATIONS
// =================================================

app.post("/apply-loan", async (req, res) => {
  const result = await applicationsCollection.insertOne({
    ...req.body,
    status: "pending",
    feeStatus: "unpaid",
    createdAt: new Date(),
  });

  res.send({ applicationId: result.insertedId });
});

app.get("/applications/:email", async (req, res) => {
  const email = req.params.email?.trim();
  if (!email) return res.send([]);

  try {
    const applications = await applicationsCollection
      .find({ borrowerEmail: { $regex: `^${email}$`, $options: "i" } })
      .toArray();

    res.send(applications);
  } catch (error) {
    console.error("Error fetching applications:", error);
    res.status(500).send({ message: "Server error" });
  }
});

app.patch("/applications/approve/:id", async (req, res) => {
  try {
    const { repayAmount, deadline } = req.body;

    if (!repayAmount || !deadline) {
      return res.status(400).send({ message: "repayAmount & deadline required" });
    }

    const result = await applicationsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          status: "approved",
          repayAmount,
          deadline,
          repayStatus: "unpaid",
          approvedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "Application not found" });
    }

    res.send({ success: true, message: "Approved successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Approve failed", error: err.message });
  }
});


// Mark application fee paid (User repayment success)
app.patch("/applications/pay/:id", async (req, res) => {
  try {
    await applicationsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          feeStatus: "paid",
          repayStatus: "paid",
          paidAt: new Date(),
        },
      }
    );

    res.send({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to mark payment as paid" });
  }
});


// Admin sends money to user (Stripe Checkout)
app.post("/payment/admin/send/:applicationId", async (req, res) => {
  try {
    const { applicationId } = req.params;

    const appData = await applicationsCollection.findOne({
      _id: new ObjectId(applicationId),
    });

    if (!appData) {
      return res.status(404).send({ message: "Application not found" });
    }

    const amount = Number(appData.loanAmount);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Loan Disbursement to ${appData.fullName}`,
            },
            unit_amount: amount * 100,
          },
          quantity: 1,
        },
      ],
      success_url: "http://localhost:5173/admin/disburse-success",
      cancel_url: "http://localhost:5173/admin/disburse-cancel",
    });

    res.send({ url: session.url });
  } catch (error) {
    console.error("Stripe Admin Send Error:", error);
    res.status(500).send({ error: error.message });
  }
});

// User repays loan (Stripe Checkout)
app.post("/payment/user/repay/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const appData = await applicationsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!appData) {
      return res.status(404).send({ message: "Application not found" });
    }

    const amount = Number(appData.repayAmount);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Loan Repayment - ${appData.loanTitle}`,
            },
            unit_amount: amount * 100,
          },
          quantity: 1,
        },
      ],
      success_url: `http://localhost:5173/payment-success/${id}`,
      cancel_url: `http://localhost:5173/payment-cancel`,
    });

    res.send({ url: session.url });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: error.message });
  }
});




app.patch("/applications/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await applicationsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: "rejected",
        },
      },
    );

    res.send({ success: true, result });
  } catch (error) {
    res.status(500).send({ error: "Failed to reject loan" });
  }
});

app.delete("/applications/:id", async (req, res) => {
  try {
    const appId = req.params.id;
    const result = await applicationsCollection.deleteOne({
      _id: new ObjectId(appId),
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Application not found" });
    }

    res.send({ message: "Application cancelled successfully" });
  } catch (err) {
    console.error("Error deleting application:", err);
    res.status(500).send({ message: "Server error" });
  }
});

app.get("/applications", async (req, res) => {
  const apps = await applicationsCollection.find().toArray();
  res.send(apps);
});

app.get("/applications/:id", async (req, res) => {
  try {
    const appData = await applicationsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    res.send(appData);
  } catch {
    res.status(400).send({ message: "Invalid ID" });
  }
});

app.patch("/applications/:id", async (req, res) => {
  const { status, comments, feeStatus } = req.body;

  await applicationsCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    {
      $set: {
        ...(status && { status }),
        ...(comments && { comments }),
        ...(feeStatus && { feeStatus }),
        updatedAt: new Date(),
      },
    },
  );

  res.send({ message: "Application updated" });
});

// =================================================
// USERS (ADMIN)
// =================================================

app.get("/users", verifyJWT, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).send({ message: "Admins only" });
  }

  const users = await usersCollection
    .find({ role: { $in: ["borrower", "manager"] } })
    .toArray();

  res.send(users);
});

app.get("/users/me", async (req, res) => {
  try {
    const user = await usersCollection.findOne({ role: "manager" });
    if (!user) return res.status(404).send({ message: "Manager not found" });
    res.send(user);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error" });
  }
});

app.patch("/users/:id", verifyJWT, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).send({ message: "Admins only" });
  }

  const { id } = req.params;
  const { role, suspendReason, suspendFeedback } = req.body;

  if (!role) return res.status(400).send({ message: "Role is required" });

  try {
    const updateFields = { role };

    if (role === "suspended") {
      updateFields.suspendReason = suspendReason || "";
      updateFields.suspendFeedback = suspendFeedback || "";
    } else {
      updateFields.suspendReason = "";
      updateFields.suspendFeedback = "";
    }

    const result = await usersCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateFields },
      { returnDocument: "after" },
    );

    if (!result) return res.status(404).send({ message: "User not found" });

    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to update user" });
  }
});

// ================= START =================
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});

// EXPORT FOR VERCEL
module.exports = app;
