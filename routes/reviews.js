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

    // Validate rating before hitting the DB
    const ratingNum = parseInt(rating, 10);
    if (!rating || isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ message: 'Rating must be a number between 1 and 5' });
    }

    let review = await AppReview.findOne({ where: { userId: req.user.id } });

    if (review) {
      review.rating = ratingNum;
      review.comment = comment || null;
      review.isApproved = false; // Require re-approval after edit
      await review.save();
    } else {
      review = await AppReview.create({
        userId: req.user.id,
        rating: ratingNum,
        comment: comment || null,
      });
    }

    res.status(200).json(review);
  } catch (error) {
    console.error('Review save error:', error);
    res.status(500).json({ message: 'Server error saving review' });
  }
});

// @desc    Get my review
// @route   GET /api/reviews/me
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const review = await AppReview.findOne({ where: { userId: req.user.id } });
    res.status(200).json(review || null);
  } catch (error) {
    console.error('Review fetch error:', error);
    res.status(500).json({ message: 'Server error fetching review' });
  }
});

// @desc    Get approved reviews (Public)
// @route   GET /api/reviews/approved
// @access  Public
// NOTE: must be declared BEFORE GET / (admin route) so Express doesn't shadow it.
router.get('/approved', async (req, res) => {
  try {
    const reviews = await AppReview.findAll({
      where: { isApproved: true },
      include: [{ model: User, as: 'user', attributes: ['name'] }],
      order: [['updatedAt', 'DESC']],
      limit: 20,
    });
    res.status(200).json(reviews);
  } catch (error) {
    console.error('Approved reviews fetch error:', error);
    res.status(500).json({ message: 'Server error fetching reviews' });
  }
});

// @desc    Delete my review
// @route   DELETE /api/reviews
// @access  Private
router.delete('/', protect, async (req, res) => {
  try {
    const review = await AppReview.findOne({ where: { userId: req.user.id } });
    if (!review) return res.status(404).json({ message: 'Review not found' });
    await review.destroy();
    res.status(200).json({ message: 'Review deleted successfully' });
  } catch (error) {
    console.error('Review delete error:', error);
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
    console.error('All reviews fetch error:', error);
    res.status(500).json({ message: 'Server error fetching all reviews' });
  }
});

module.exports = router;
