const Sequelize = require('sequelize');
const {models} = require("../models");
const Op = Sequelize.Op;
const paginate = require('../helpers/paginate').paginate;
var ssn;

// GET /stats
exports.stats = (req,res,next) => {
	let nusers,nquizzes,ntips;
	let bestUsers = [];

	const bestOptions = {
		order: [ ['points', 'DESC'] ]
	};

	models.user.count()
	.then(count => {
		nusers = count;
		models.user.findAll(bestOptions)
		.then(quizzes => {
			quizzes.length = 10;
			bestUsers = quizzes;
			models.quiz.count()
			.then(count => {
				nquizzes = count;
				models.tip.count()
				.then(count => {
					ntips = count;
					return res.render('stats/stats.ejs', {nusers,nquizzes,ntips,bestUsers} );
				});
			});
		});
	}).catch(error => next(error));
};

// GET /userstats/:userId 
exports.userstats = (req,res,next) => {
	const userOptions = {
		include: [
			{model: models.quiz, as: 'quizzes'},
			{model: models.tip, as: 'tips'}
		]
	};

	models.user.findByPk(req.user.id,userOptions)
	.then(user => {
		return res.render('stats/userstats.ejs', {user} );
	}).catch(error => next(error));
};