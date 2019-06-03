'use strict';

module.exports = {
  up(queryInterface, Sequelize) {

    return queryInterface.bulkInsert('quizzes', [
      {   
          choice: false, 
          question: 'Who invented the telephone?',
          answer: 'Bell',
          createdAt: new Date(),
          updatedAt: new Date()
      },
            {   
          choice: false, 
          question: 'Java is to Javascript the same as Car is to...',
          answer: 'Carpet',
          createdAt: new Date(),
          updatedAt: new Date()
      },
      {   
          choice: true,
          question: 'This site is created with',
          answer: 'Javascript',
          answer1: 'Javascript',
          answer2: 'Java',
          answer3: 'C++',
          createdAt: new Date(),
          updatedAt: new Date()
      },
      {
                choice: true,
          question: 'For which subject is this project to?',
          answer: 'CORE',
          answer1: 'ENRG',
          answer2: 'COTE',
          answer3: 'CORE',
          createdAt: new Date(),
          updatedAt: new Date()
      }
    ]);
  },

  down(queryInterface, Sequelize) {

    return queryInterface.bulkDelete('quizzes', null, {});
  }
};
