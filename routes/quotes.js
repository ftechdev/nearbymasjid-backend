const express = require('express');
const router = express.Router();
const Quote = require('../models/Quote');
const { protect, admin } = require('../middleware/auth');

// --- PUBLIC ROUTE: Get Quote of the Day ---
router.get('/daily', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    // 1. Check if there is already a quote for today
    let dailyQuote = await Quote.findOne({
      where: {
        lastShownDate: today
      }
    });

    if (dailyQuote) {
      return res.json(dailyQuote);
    }

    // 2. If no quote for today, find a quote that wasn't shown today
    // Let's order by lastShownDate ascending (nulls first usually, or oldest first)
    // and pick the first one.
    dailyQuote = await Quote.findOne({
      order: [
        // prioritize quotes that have never been shown (lastShownDate is null)
        ['lastShownDate', 'ASC']
      ]
    });

    if (!dailyQuote) {
      return res.status(404).json({ message: 'No quotes available' });
    }

    // 3. Update the chosen quote's lastShownDate to today
    dailyQuote.lastShownDate = today;
    await dailyQuote.save();

    res.json(dailyQuote);
  } catch (err) {
    console.error(err);
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
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// Add a new quote
router.post('/', protect, admin, async (req, res) => {
  try {
    const { text, reference } = req.body;
    if (!text) {
      return res.status(400).json({ message: 'Quote text is required' });
    }

    const quote = await Quote.create({ text, reference });
    res.status(201).json(quote);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// Delete a quote
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const quote = await Quote.findByPk(req.params.id);
    if (!quote) {
      return res.status(404).json({ message: 'Quote not found' });
    }
    await quote.destroy();
    res.json({ message: 'Quote removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;
