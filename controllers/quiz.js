const Sequelize = require("sequelize");
const Op = Sequelize.Op;
const {models} = require("../models");
const cloudinary = require('cloudinary');
const fs = require('fs');
const attHelper = require("../helpers/attachments");

const multer  = require('multer');

const paginate = require('../helpers/paginate').paginate;

// Options for the files uploaded to Cloudinary
const cloudinary_upload_options = {
    async: false,
    folder: "/core/quiz2018/attachments",
    resource_type: "auto",
    tags: ['core', 'iweb', 'cdps', 'quiz']
};


// Autoload el quiz asociado a :quizId
exports.load = (req, res, next, quizId) => {

    const options = {
        include: [
            models.tip,
            models.attachment,
            {model: models.user, as: 'author'}
        ]
    };

    // For logged in users: include the favourites of the question by filtering by
    // the logged in user with an OUTER JOIN.
    if (req.session.user) {
        options.include.push({
            model: models.user,
            as: "fans",
            where: {id: req.session.user.id},
            required: false  // OUTER JOIN
        });
    }

    models.quiz.findByPk(quizId, options)
    .then(quiz => {
        if (quiz) {
            req.quiz = quiz;
            next();
        } else {
            throw new Error('There is no quiz with id=' + quizId);
        }
    })
    .catch(error => next(error));
};


// MW that allows actions only if the user logged in is admin or is the author of the quiz.
exports.adminOrAuthorRequired = (req, res, next) => {

    const isAdmin  = !!req.session.user.isAdmin;
    const isAuthor = req.quiz.authorId === req.session.user.id;

    if (isAdmin || isAuthor) {
        next();
    } else {
        console.log('Prohibited operation: The logged in user is not the author of the quiz, nor an administrator.');
        res.send(403);
    }
};


// GET /quizzes
exports.index = (req, res, next) => {

    let countOptions = {
        where: {},
        include: []
    };

    const searchfavourites = req.query.searchfavourites || "";

    let title = "Questions";

    // Search:
    const search = req.query.search || '';
    if (search) {
        const search_like = "%" + search.replace(/ +/g,"%") + "%";

        countOptions.where = {question: { [Op.like]: search_like }};
    }

    // If there exists "req.user", then only the quizzes of that user are shown
    if (req.user) {
        countOptions.where.authorId = req.user.id;

        if (req.session.user && req.session.user.id == req.user.id) {
            title = "My Questions";
        } else {
            title = "Questions of " + req.user.username;
        }
    }

    // Filter: my favourite quizzes:
    if (req.session.user) {
        if (searchfavourites) {
            countOptions.include.push({
                model: models.user,
                as: "fans",
                where: {id: req.session.user.id},
                attributes: ['id']

            });
        } else {

            // NOTE:
            // It should be added the options ( or similars )
            // to have a lighter query:
            //    where: {id: req.session.user.id},
            //    required: false  // OUTER JOIN
            // but this does not work with SQLite. The generated
            // query fails when there are several fans of the same quiz.

            countOptions.include.push({
                model: models.user,
                as: "fans",
                attributes: ['id']
            });
        }
    }

    models.quiz.count(countOptions)
    .then(count => {

        // Pagination:

        const items_per_page = 10;

        // The page to show is given in the query
        const pageno = parseInt(req.query.pageno) || 1;

        // Create a String with the HTMl used to render the pagination buttons.
        // This String is added to a local variable of res, which is used into the application layout file.
        res.locals.paginate_control = paginate(count, items_per_page, pageno, req.url);

        const findOptions = {
            ...countOptions,
            offset: items_per_page * (pageno - 1),
            limit: items_per_page
        };

        findOptions.include.push(models.attachment);
        findOptions.include.push({
            model: models.user,
            as: 'author'
        });

        return models.quiz.findAll(findOptions);
    })
    .then(quizzes => {

        const format = (req.params.format || 'html').toLowerCase();

        switch (format) {
            case 'html':

                // Mark favourite quizzes:
                if (req.session.user) {
                    quizzes.forEach(quiz => {
                        quiz.favourite = quiz.fans.some(fan => {
                            return fan.id == req.session.user.id;
                        });
                    });
                }

                res.render('quizzes/index.ejs', {
                    quizzes,
                    search,
                    searchfavourites,
                    title,
                    attHelper
                });
                break;

            case 'json':
                res.json(quizzes);
                break;

            default:
                console.log('No supported format \".' + format + '\".');
                res.sendStatus(406);
        }
    })
    .catch(error => next(error));
};


// GET /quizzes/:quizId
exports.show = (req, res, next) => {

    const {quiz} = req;

    const format = (req.params.format || 'html').toLowerCase();

    switch (format) {
        case 'html':

            new Promise((resolve, reject) => {

                // Only for logger users:
                //   if this quiz is one of my fovourites, then I create
                //   the attribute "favourite = true"
                if (req.session.user) {
                    resolve(
                        req.quiz.getFans({where: {id: req.session.user.id}})
                        .then(fans => {
                            if (fans.length > 0) {
                                req.quiz.favourite = true;
                            }
                        })
                    );
                } else {
                    resolve();
                }
            })
            .then(() => {
                res.render('quizzes/show', {
                    quiz,
                    attHelper
                });
            })
            .catch(error => next(error));
            break;

        case 'json':
            res.json(quiz);
            break;

        default:
            console.log('No supported format \".' + format + '\".');
            res.sendStatus(406);
    }
};


// GET /quizzes/new
exports.new = (req, res, next) => {

    const quiz = {
        question: "",
        answer: ""
    };

    res.render('quizzes/new', {quiz});
};

// POST /quizzes/create
exports.create = (req, res, next) => {

    const upload = multer({dest: './uploads/', limits: {fileSize: 2 * 1024 * 1024}}).single('image');

    new Sequelize.Promise((resolve, reject) => {

        // loads fields from multipart form.
        upload(req, res, error => {

            if (error instanceof multer.MulterError) {
                // A Multer error occurred when uploading.
                req.flash('error', 'Failure uploading attachment file to the server: ' + error.message);
                reject(error);
            } else if (error) {
                // An unknown error occurred when uploading.
                reject(error);
            } else {
                // Everything went fine.
                resolve();
            }
        })
    })
    .then(() => {

        const {question, answer} = req.body;

        const authorId = req.session.user && req.session.user.id || 0;

        const quiz = models.quiz.build({
            question,
            answer,
            authorId
        });

        // Saves only the fields question and answer into the DDBB
        return quiz.save({fields: ["question", "answer", "authorId"]});
    })
    .then(quiz => {
        req.flash('success', 'Quiz created successfully.');

        if (!req.file) {
            req.flash('info', 'Quiz without attachment.');
            res.redirect('/quizzes/' + quiz.id);
            return;
        }

        // Save the attachment into  Cloudinary or local file system:

        if (!process.env.CLOUDINARY_URL) {
            req.flash('info', 'Attrachment files are saved into the local file system.');
        } else {
            req.flash('info', 'Attrachment files are saved at Cloudinary.');
        }

        return attHelper.uploadResource(req.file.path, cloudinary_upload_options)
        .then(uploadResult => {

            // Create the new attachment into the data base.
            return models.attachment.create({
                public_id: uploadResult.public_id,
                url: uploadResult.url,
                filename: req.file.originalname,
                mime: req.file.mimetype,
                quizId: quiz.id })
            .then(attachment => {
                req.flash('success', 'Image saved successfully.');
            })
            .catch(error => { // Ignoring validation errors
                req.flash('error', 'Failed to save file: ' + error.message);
                attHelper.deleteResource(uploadResult.public_id);
            });

        })
        .catch(error => {
            req.flash('error', 'Failed to save attachment: ' + error.message);
        })
        .then(() => {
            fs.unlink(req.file.path, err => {
                if (err) {
                    console.log(`Error deleting file: ${req.file.path} >> ${err}`);
                }
            }); // delete the file uploaded at./uploads
            res.redirect('/quizzes/' + quiz.id);
        });
    })
    .catch(Sequelize.ValidationError, error => {
        req.flash('error', 'There are errors in the form:');
        error.errors.forEach(({message}) => req.flash('error', message));
        res.render('quizzes/new', {quiz});
    })
    .catch(error => {
        req.flash('error', 'Error creating a new Quiz: ' + error.message);
        next(error);
    });
};


// GET /quizzes/:quizId/edit
exports.edit = (req, res, next) => {

    const {quiz} = req;

    res.render('quizzes/edit', {quiz});
};


// PUT /quizzes/:quizId
exports.update = (req, res, next) => {

    const upload = multer({dest: './uploads/', limits: {fileSize: 2 * 1024 * 1024}}).single('image');

    new Sequelize.Promise((resolve, reject) => {

        // loads fields from multipart form.
        upload(req, res, error => {

            if (error instanceof multer.MulterError) {
                // A Multer error occurred when uploading.
                req.flash('error', 'Failure uploading attachment file to the server: ' + error.message);
                reject(error);
            } else if (error) {
                // An unknown error occurred when uploading.
                reject(error);
            } else {
                // Everything went fine.
                resolve();
            }
        })
    })
    .then(() => {

        const {quiz, body} = req;

        quiz.question = body.question;
        quiz.answer = body.answer;

        return quiz.save({fields: ["question", "answer"]});
    })
    .then(quiz => {
        req.flash('success', 'Quiz edited successfully.');

        if (req.body.keepAttachment) {

            if (req.file) {
                fs.unlink(req.file.path, err => {
                    if (err) {
                        console.log(`Error deleting ${req.file.path} file: ${err}`);
                    }
                }); // delete the file uploaded at./uploads
            }

        } else {
            // There is no attachment: Delete old attachment.
            if (!req.file) {
                req.flash('info', 'This quiz has no attachment.');
                if (quiz.attachment) {
                    attHelper.deleteResource(quiz.attachment.public_id);
                    quiz.attachment.destroy();
                }
                return;
            }

            // Save the new attachment into Cloudinary or local file system:

            if (!process.env.CLOUDINARY_URL) {
                req.flash('info', 'Attrachment files are saved into the local file system.');
            } else {
                req.flash('info', 'Attrachment files are saved at Cloudinary.');
            }

            return attHelper.uploadResource(req.file.path, cloudinary_upload_options)
            .then(function (uploadResult) {

                // Remenber the public_id of the old image.
                const old_public_id = quiz.attachment ? quiz.attachment.public_id : null;

                // Update the attachment into the data base.
                return quiz.getAttachment()
                .then(function(attachment) {
                    if (!attachment) {
                        attachment = models.attachment.build({ quizId: quiz.id });
                    }
                    attachment.public_id = uploadResult.public_id;
                    attachment.url = uploadResult.url;
                    attachment.filename = req.file.originalname;
                    attachment.mime = req.file.mimetype;
                    return attachment.save();
                })
                .then(function(attachment) {
                    req.flash('success', 'Image saved successfully.');
                    if (old_public_id) {
                        attHelper.deleteResource(old_public_id);
                    }
                })
                .catch(function(error) { // Ignoring image validation errors
                    req.flash('error', 'Failed saving new image: '+error.message);
                    attHelper.deleteResource(uploadResult.public_id);
                });


            })
            .catch(function(error) {
                req.flash('error', 'Failed saving the new attachment: ' + error.message);
            })
            .then(function () {
                fs.unlink(req.file.path, err => {
                    if (err) {
                        console.log(`Error deleting file: ${req.file.path} >> ${err}`);
                    }
                }); // delete the file uploaded at./uploads
            });
        }
    })
    .then(function () {
        res.redirect('/quizzes/' + req.quiz.id);
    })
    .catch(Sequelize.ValidationError, error => {
        req.flash('error', 'There are errors in the form:');
        error.errors.forEach(({message}) => req.flash('error', message));
        res.render('quizzes/edit', {quiz});
    })
    .catch(error => {
        req.flash('error', 'Error editing the Quiz: ' + error.message);
        next(error);
    });
};


// DELETE /quizzes/:quizId
exports.destroy = (req, res, next) => {

    // Delete the attachment at Cloudinary (result is ignored)
    if (req.quiz.attachment) {

        if (!process.env.CLOUDINARY_URL) {
            req.flash('info', 'Attrachment files are saved into the local file system.');
        } else {
            req.flash('info', 'Attrachment files are saved at Cloudinary.');
        }

        attHelper.deleteResource(req.quiz.attachment.public_id);
    }

    req.quiz.destroy()
    .then(() => {
        req.flash('success', 'Quiz deleted successfully.');
        res.redirect('/goback');
    })
    .catch(error => {
        req.flash('error', 'Error deleting the Quiz: ' + error.message);
        next(error);
    });
};


// GET /quizzes/:quizId/play
exports.play = (req, res, next) => {

    const {quiz, query} = req;

    const answer = query.answer || '';

    new Promise(function (resolve, reject) {

        // Only for logger users:
        //   if this quiz is one of my fovourites, then I create
        //   the attribute "favourite = true"
        if (req.session.user) {
            resolve(
                req.quiz.getFans({where: {id: req.session.user.id}})
                .then(fans => {
                    if (fans.length > 0) {
                        req.quiz.favourite = true
                    }
                })
            );
        } else {
            resolve();
        }
    })
    .then(() => {
        res.render('quizzes/play', {
            quiz,
            answer,
            attHelper
        });
    })
    .catch(error => next(error));
};

const randomPlayNextQuiz = (req, res, next) => {

    if (!req.session.randomPlay) {
        req.session.randomPlay = {
            currentQuizId: 0,
            resolved: []
        };
    }

    Sequelize.Promise.resolve()
        .then(() => {
            // volver a mostrar la misma pregunta que la ultima vez que pase por aqui y no conteste:
            if (req.session.randomPlay.currentQuizId) {
                return req.session.randomPlay.currentQuizId;
            } else {
                // elegir una pregunta al azar no repetida:
                return randomQuizId(req.session.randomPlay.resolved);
            }
        })
        .then(quizId => {

            if (!quizId) {

                const score = req.session.randomPlay.resolved.length;

                delete req.session.randomPlay;

                res.json({nomore: true, score});
            } else {

                return models.quiz.findById(quizId, {
                    attributes: {exclude: ['createdAt', 'updatedAt', 'deletedAt']},
                    include: [
                        {
                            model: models.tip,
                            where: {accepted: true},
                            required: false,
                            attributes: ['text']
                        },
                        {
                            model: models.attachment,
                            attributes: ['filename', 'mime', 'url']
                        },
                        {
                            model: models.user,
                            as: 'author',
                            attributes: ['isAdmin', 'username']
                        },
                        {
                            model: models.user,
                            as: "fans",
                            attributes: ['id'],
                            through: {attributes: []}
                        }
                    ]
                })
                    .then(quiz => {
                        if (!quiz) {
                            throw new Error('There is no quiz with id=' + quizId);
                        }

                        const score = req.session.randomPlay.resolved.length;

                        req.session.randomPlay.currentQuizId = quizId;

                        // If this quiz is one of my favourites, then I create
                        // the attribute "favourite = true"

                        res.json({
                            quiz: {
                                id: quiz.id,
                                question: quiz.question,
                                author: quiz.author,
                                attachment: quiz.attachment,
                                favourite: quiz.fans.some(fan => fan.id == req.token.userId),
                                tips: quiz.tips.map(tip => tip.text)
                            },
                            score
                        });
                    });

            }
        })
        .catch(error => next(error));
};
exports.randomPlayNew = (req, res, next) => {

    req.session.randomPlay = {
        currentQuizId: 0,
        resolved: []
    };

    randomPlayNextQuiz(req, res, next);
};
// GET /quizzes/random
exports.random = (req, res, next) => {

    const {token} = req;

    randomQuizId([])
        .then(quizId => {

            if (quizId) {
                return models.quiz.findById(quizId, {
                    attributes: {exclude: ['createdAt', 'updatedAt', 'deletedAt']},
                    include: [
                        {
                            model: models.tip,
                            where: {accepted: true},
                            required: false,
                            attributes: ['text']
                        },
                        {
                            model: models.attachment,
                            attributes: ['filename', 'mime', 'url']
                        },
                        {
                            model: models.user,
                            as: 'author',
                            attributes: ['isAdmin', 'username']
                        },
                        {
                            model: models.user,
                            as: "fans",
                            attributes: ['id'],
                            through: {attributes: []}
                        }]
                })
                    .then(quiz => {
                        if (!quiz) {
                            throw new Error('There is no quiz with id=' + quizId);
                        }

                        // If this quiz is one of my favourites, then I create
                        // the attribute "favourite = true"

                        res.json({
                            id: quiz.id,
                            question: quiz.question,
                            author: quiz.author,
                            attachment: quiz.attachment,
                            favourite: quiz.fans.some(fan => fan.id == token.userId),
                            tips: quiz.tips.map(tip => tip.text)
                        });
                    });
            } else {
                res.json({nomore: true});
            }
        })
        .catch(error => next(error));
};

exports.randomPlayCheck = (req, res, next) => {

    if (!req.session.randomPlay ||
        (req.session.randomPlay.currentQuizId === 0)) {
        res.sendStatus(409);
        return;
    }

    const quizId = req.session.randomPlay.currentQuizId;

    models.quiz.findById(quizId)
        .then(function (quiz) {
            if (quiz) {

                const answer = req.query.answer || "";

                const result = answer.toLowerCase().trim() === quiz.answer.toLowerCase().trim();

                if (result) {
                    req.session.randomPlay.currentQuizId = 0;

                    // Evitar que me hagan llamadas a este metodo manualmente con una respuesta acertada para
                    // que se guarde muchas veces la misma respuesta en resolved, y asi conseguir que score
                    // se incremente indebidamente.
                    if (req.session.randomPlay.resolved.indexOf(quiz.id) == -1) {
                        req.session.randomPlay.resolved.push(quiz.id);
                    }
                }

                const score = req.session.randomPlay.resolved.length;

                if (!result) {
                    delete req.session.randomPlay;
                }

                res.json({
                    answer,
                    quizId: quiz.id,
                    result,
                    score});

            } else {
                throw new Error('There is no quiz with id=' + quizId);
            }
        })
        .catch(function (error) {
            next(error);
        });
};

//-----------------------------------------------------------

// GET /quizzes/random10wa
exports.random10wa = async (req, res, next) => {

    try {
        const {token} = req;

        let quizIds = [];
        let quizzes = [];

        const count = await models.quiz.count();

        for (let i = 0; i < 10 && i < count; i++) {
            const whereOpt = {'id': {[Sequelize.Op.notIn]: quizIds}};

            const qarr = await models.quiz.findAll({
                where: whereOpt,
                attributes: {exclude: ['createdAt', 'updatedAt', 'deletedAt']},
                include: [
                    {
                        model: models.tip,
                        where: {accepted: true},
                        required: false,
                        attributes: ['text']
                    },
                    {
                        model: models.attachment,
                        attributes: ['filename', 'mime', 'url']
                    },
                    {
                        model: models.user,
                        as: 'author',
                        attributes: ['isAdmin', 'username']
                    },
                    {
                        model: models.user,
                        as: "fans",
                        attributes: ['id'],
                        through: {attributes: []}
                    }
                ],
                offset: Math.floor(Math.random() * (count - i)),
                limit: 1
            });

            if (!qarr.length) break;

            const quiz = qarr[0]

            quizIds.push(quiz.id);
            quizzes.push(quiz);
        }

        // If this quiz is one of my favourites, then I create
        // the attribute "favourite = true"

        res.json(quizzes.map(quiz => ({
            id: quiz.id,
            question: quiz.question,
            answer: quiz.answer,
            author: quiz.author,
            attachment: quiz.attachment,
            favourite: quiz.fans.some(fan => fan.id == token.userId),
            tips: quiz.tips.map(tip => tip.text)
        })));
    }
    catch(error) {
        next(error);
    }
};

//-----------------------------------------------------------

/**
 * Returns a promise to get a random quizId.
 * Excludes the ids given in the parameter.
 *
 * @param exclude Array of ids to exclude.
 *
 * @return A promise
 */
const randomQuizId = exclude => {

    const whereOpt = {'id': {[Sequelize.Op.notIn]: exclude}};

    return models.quiz.count({where: whereOpt})
        .then(count => models.quiz.findAll({
            where: whereOpt,
            offset: Math.floor(Math.random() * count),
            limit: 1
        }))
        .then(quizzes => quizzes.length ? quizzes[0].id : 0);
};



// GET /quizzes/:quizId/check
exports.check = (req, res, next) => {

    const {quiz, query} = req;

    const answer = query.answer || "";
    const result = answer.toLowerCase().trim() === quiz.answer.toLowerCase().trim();

    res.render('quizzes/result', {
        quiz,
        result,
        answer
    });
};
