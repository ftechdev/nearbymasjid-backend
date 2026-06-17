const express = require('express');
const router = express.Router();
const AppReview = require('../models/AppReview');
const User = require('../models/User');
const { protect, admin } = require('../middleware/auth');

// @desc    Create or Update my review
// @route   POST /api/reviews
// @access  Private
router.post('/', protect, async (req, res) => {
  try {
    const { rating, comment } = req.body;
    let review = await AppReview.findOne({ where: { userId: req.user.id } });

    if (review) {
      // Update existing review
      review.rating = rating;
      review.comment = comment;
      review.isApproved = false; // Require re-approval after edit
      await review.save();
    } else {
      // Create new review
      review = await AppReview.create({
        userId: req.user.id,
        rating,
        comment,
      });
    }

    res.status(200).json(review);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error saving review' });
  }
});

// @desc    Get my review
// @route   GET /api/reviews/me
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const review = await AppReview.findOne({ where: { userId: req.user.id } });
    if (!review) {
      return res.status(200).json(null);
    }
    res.status(200).json(review);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error fetching review' });
  }
});

// @desc    Delete my review
// @route   DELETE /api/reviews
// @access  Private
router.delete('/', protect, async (req, res) => {
  try {
    const review = await AppReview.findOne({ where: { userId: req.user.id } });
    if (review) {
      await review.destroy();
      res.status(200).json({ message: 'Review deleted successfully' });
    } else {
      res.status(404).json({ message: 'Review not found' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error deleting review' });
  }
});

// @desc    Get all reviews (Admin only)
// @route   GET /api/reviews
// @access  Private/Admin
router.get('/', protect, admin, async (req, res) => {
  try {
    const reviews = await AppReview.findAll({
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
      order: [['createdAt', 'DESC']],
    });
    res.status(200).json(reviews);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error fetching all reviews' });
  }
});

// @desc    Get approved reviews (Public)
// @route   GET /api/reviews/approved
// @access  Public
router.get('/approved', async (req, res) => {
  try {
    const reviews = await AppReview.findAll({
      where: { isApproved: true },
      include: [{ model: User, as: 'user', attributes: ['name'] }],
      order: [['updatedAt', 'DESC']],
      limit: 20
    });
    res.status(200).json(reviews);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error fetching reviews' });
  }
});

module.exports = router;
