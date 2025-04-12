const express = require('express');
const router = express.Router();
const Course = require('../models/Course');
const Problem = require('../models/Problem');
const User = require('../models/User');
const { auth, isStudent } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

// Apply auth and student middleware to all routes
router.use(auth);
router.use(isStudent);

// Dashboard
router.get('/dashboard', asyncHandler(async (req, res) => {
  const enrolledCourses = await Course.find({
    'students': req.user._id
  }).populate('instructor', 'profile.firstName profile.lastName');

  res.render('student/dashboard', {
    title: 'Student Dashboard',
    user: req.user,
    courses: enrolledCourses
  });
}));

// Course Routes
router.get('/courses', asyncHandler(async (req, res) => {
  const enrolledCourses = await Course.find({
    'students': req.user._id
  }).populate('instructor', 'profile.firstName profile.lastName');

  const availableCourses = await Course.find({
    status: 'active',
    students: { $ne: req.user._id },
    $or: [
      { maxStudents: { $gt: { $size: '$students' } } },
      { maxStudents: { $exists: false } }
    ]
  }).populate('instructor', 'profile.firstName profile.lastName');

  res.render('student/courses', {
    title: 'Available Courses',
    user: req.user,
    enrolledCourses,
    courses: availableCourses
  });
}));

router.get('/courses/:id', asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id)
    .populate('instructor', 'profile.firstName profile.lastName')
    .populate('content')
    .populate('assignments');

  if (!course) {
    req.flash('error', 'Course not found');
    return res.redirect('/student/courses');
  }

  const isEnrolled = course.students.includes(req.user._id);

  res.render('student/course-details', {
    title: course.title,
    user: req.user,
    course,
    isEnrolled
  });
}));

router.post('/courses/:id/enroll', asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id);
  
  if (!course) {
    req.flash('error', 'Course not found');
    return res.redirect('/student/courses');
  }

  if (course.students.includes(req.user._id)) {
    req.flash('error', 'Already enrolled in this course');
    return res.redirect(`/student/courses/${course._id}`);
  }

  if (course.students.length >= course.maxStudents) {
    req.flash('error', 'Course is full');
    return res.redirect('/student/courses');
  }

  course.students.push(req.user._id);
  await course.save();

  await User.findByIdAndUpdate(req.user._id, {
    $push: {
      enrolledCourses: {
        course: course._id,
        enrolledAt: new Date()
      }
    }
  });

  req.flash('success', 'Successfully enrolled in course');
  res.redirect(`/student/courses/${course._id}`);
}));

// Problem Routes
router.get('/problems', asyncHandler(async (req, res) => {
  const { difficulty, category } = req.query;
  let query = {};

  if (difficulty) query.difficulty = difficulty;
  if (category) query.category = category;

  const problems = await Problem.find(query);
  res.render('student/problems', {
    title: 'Coding Problems',
    user: req.user,
    problems
  });
}));

router.get('/problems/:id/solve', asyncHandler(async (req, res) => {
  const problem = await Problem.findById(req.params.id);
  if (!problem) {
    req.flash('error', 'Problem not found');
    return res.redirect('/student/problems');
  }

  res.render('student/code-editor', {
    title: problem.title,
    user: req.user,
    problem
  });
}));

// Code Submission Routes
router.post('/code/run', asyncHandler(async (req, res) => {
  const { code, language, problemId } = req.body;
  const problem = await Problem.findById(problemId);

  if (!problem) {
    return res.status(404).json({ error: 'Problem not found' });
  }

  // Run code against test cases
  const results = await runTestCases(code, language, problem.testCases);
  res.json(results);
}));

router.post('/code/submit', asyncHandler(async (req, res) => {
  const { code, language, problemId } = req.body;
  const problem = await Problem.findById(problemId);

  if (!problem) {
    return res.status(404).json({ error: 'Problem not found' });
  }

  // Run submission against all test cases
  const results = await runTestCases(code, language, problem.testCases);
  const submission = {
    student: req.user._id,
    code,
    language,
    status: results.allPassed ? 'accepted' : 'wrong_answer',
    runtime: results.runtime,
    memory: results.memory,
    testCasesPassed: results.passedCount,
    score: calculateScore(results)
  };

  problem.submissions.push(submission);
  await problem.save();

  // Update user's coding stats
  if (results.allPassed) {
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { 'profile.codingStats.problemsSolved': 1 }
    });
  }

  res.json({
    success: true,
    results,
    submission
  });
}));

// Helper Functions
async function runTestCases(code, language, testCases) {
  // Mock implementation - replace with actual code execution service
  return {
    allPassed: true,
    runtime: 100,
    memory: 50,
    passedCount: testCases.length,
    testCases: testCases.map(test => ({
      input: test.input,
      expectedOutput: test.expectedOutput,
      actualOutput: test.expectedOutput,
      passed: true
    }))
  };
}

function calculateScore(results) {
  return results.allPassed ? 100 : Math.floor((results.passedCount / results.testCases.length) * 100);
}

module.exports = router;