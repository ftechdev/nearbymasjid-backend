const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../config/db');
const Quote = require('../models/Quote');
const { protect, admin } = require('../middleware/auth');

// --- PUBLIC ROUTE: Get Quote of the Day ---
// Wrapped in a serializable transaction so concurrent requests can't both
// claim "no quote today" and each update a different row — only one wins.
router.get('/daily', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    let dailyQuote = await sequelize.transaction(
      { isolationLevel: sequelize.Transaction.ISOLATION_LEVELS.SERIALIZABLE },
      async (t) => {
        // 1. Already assigned for today?
        let quote = await Quote.findOne({ where: { lastShownDate: today }, transaction: t });
        if (quote) return quote;

        // 2. Pick the least-recently-shown (nulls first = never shown)
        quote = await Quote.findOne({
          where: { lastShownDate: { [Op.or]: [null, { [Op.ne]: today }] } },
          order: [['lastShownDate', 'ASC NULLS FIRST']],
          transaction: t,
          lock: t.LOCK.UPDATE, // row-level lock to prevent duplicate selection
        });

        if (!quote) return null;

        quote.lastShownDate = today;
        await quote.save({ transaction: t });
        return quote;
      }
    );

    if (!dailyQuote) {
      return res.status(404).json({ message: 'No quotes available' });
    }
    res.json(dailyQuote);
  } catch (err) {
    console.error('Daily quote error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// --- ADMIN ROUTES ---

// Get all quotes
router.get('/', protect, admin, async (req, res) => {
  try {
    const quotes = await Quote.findAll({ order: [['createdAt', 'DESC']] });
    res.json(quotes);
  } catch (err) {
    console.error('Quotes list error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// Add a new quote
router.post('/', protect, admin, async (req, res) => {
  try {
    const { text, reference } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Quote text is required' });
    }
    const quote = await Quote.create({ text: text.trim(), reference: reference?.trim() || '' });
    res.status(201).json(quote);
  } catch (err) {
    console.error('Quote create error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// Delete a quote
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const quote = await Quote.findByPk(req.params.id);
    if (!quote) return res.status(404).json({ message: 'Quote not found' });
    await quote.destroy();
    res.json({ message: 'Quote removed' });
  } catch (err) {
    console.error('Quote delete error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;
