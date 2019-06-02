
const express = require('express');
const router = express.Router();


const quizRouter = require('./quiz');
const apiRouter = require('./api');

// Routes mounted at '/api'.
router.use('/api', apiRouter);

// Routes mounted at '/'.
router.use(/^(?!\/api\/)/, quizRouter);

//-----------------------------------------------------------

module.exports = router;
