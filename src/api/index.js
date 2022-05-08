const express = require("express");
const router = express.Router();

const { generateNonce } = require("siwe");
const { ethers } = require("ethers");
const jwt = require("jsonwebtoken");

const userModel = require("./repository/models");
const { authenticateUser } = require("./middleware");
const checkIfEligibleForRoles = require("../cron/checkIfEligibleForRoles");
const checkIfFollowingSocials = require("../cron/checkIfFollowingSocials");

const signJwt = (user) => {
  const token = jwt.sign(user, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
  return token;
};

router.post("/nonce", async (req, res) => {
  const nonce = generateNonce();
  const walletAddress = req.body.walletAddress;

  try {
    const user = await userModel.findOne({ walletAddress });
    if (user) {
      await userModel.findOneAndUpdate({ walletAddress }, { nonce });
    } else {
      await userModel.create({ walletAddress, nonce });
    }
    res.send(nonce);
  } catch (e) {
    res.status(500).send("An error occured, please contact administrator");
  }
});

router.post("/validate_signature", async (req, res) => {
  let walletAddress = req.body.walletAddress;
  const signature = req.body.signature;
  const nonce = req.body.nonce;
  walletAddress = walletAddress.toLowerCase();

  try {
    const signerAddress = ethers.utils.verifyMessage(nonce, signature);
    if (signerAddress.toLocaleLowerCase() !== walletAddress) {
      throw new Error("Signature validation failed");
    }
    const user = await userModel.findOne({ walletAddress, nonce }).lean();
    if (!user) {
      throw new Error("User not found");
    }
    // set jwt to the user's browser cookies
    const token = signJwt(user);
    const secure = process.env.NODE_ENV !== "development";
    res.cookie("token", token, {
      secure,
      httpOnly: true,
      maxAge: 720 * 60 * 60 * 1000, // 30 days
    });
    res.send("success");
  } catch (e) {
    res.status(400).send(e.message);
  }
});

router.get("/isAuthenticated", authenticateUser, (req, res) => {
  if (req?.walletAddress) {
    res.status(200).send({ walletAddress: req?.walletAddress });
  } else {
    res.status(401).send("nein");
  }
});

router.get("/logout", authenticateUser, async (req, res) => {
  res.clearCookie("token");
  res.status(401).send(`Logged out`);
});

router.get("/user", authenticateUser, async (req, res) => {
  const walletAddress = req?.walletAddress;
  try {
    let user = await userModel.findOne({ walletAddress }).lean();
    await checkIfEligibleForRoles.updateStatsForOneUser(user);
    await checkIfFollowingSocials.updateStatsForOneUser(user);
    user = await userModel.findOne({ walletAddress }).lean();
    res.json({
      discordName: user.discordName,
      twitterName: user.twitterName,
      isFollowingFromTwitter: user.isFollowingFromTwitter,
      isDiscordMember: user.isDiscordMember,
      ownedNFTCount: user.ownedNFTCount,
    });
  } catch (e) {
    res.status(500).send("Something went wrong");
  }
});

module.exports = router;
