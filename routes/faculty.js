const express = require('express');
const router = express.Router();
const Course = require('../models/Course');
const Assignment = require('../models/Assignment');
const Attendance = require('../models/Attendance');
const { auth, isFaculty } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const multer = require('multer');
const path = require('path');

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/course-content');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'video/mp4',
      'video/webm',
      'image/jpeg',
      'image/png',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Apply auth and faculty middleware to all routes
router.use(auth);
router.use(isFaculty);

// Dashboard
router.get('/dashboard', asyncHandler(async (req, res) => {
  try {
    const courses = await Course.find({ instructor: req.user._id })
      .populate('students')
      .populate('assignments');

    const analytics = await generateCourseAnalytics(courses);

    res.render('faculty/dashboard', {
      title: 'Faculty Dashboard',
      user: req.user,
      courses,
      analytics,
      activities: []
    });
  } catch (error) {
    console.error('Dashboard Error:', error);
    req.flash('error', 'Error loading dashboard');
    res.status(500).render('error', { 
      message: 'Error loading dashboard',
      error: { status: 500, stack: error.stack }
    });
  }
}));

// Course Routes
router.get('/courses', asyncHandler(async (req, res) => {
  try {
    const courses = await Course.find({ instructor: req.user._id })
      .populate('students')
      .populate('assignments')
      .sort('-createdAt');

    res.render('faculty/courses', {
      title: 'My Courses',
      user: req.user,
      courses
    });
  } catch (error) {
    console.error('Courses Error:', error);
    req.flash('error', 'Error loading courses');
    res.redirect('/faculty/dashboard');
  }
}));

router.get('/courses/new', asyncHandler(async (req, res) => {
  try {
    res.render('faculty/course-form', {
      title: 'Create New Course',
      user: req.user,
      course: null
    });
  } catch (error) {
    console.error('New Course Form Error:', error);
    req.flash('error', 'Error loading course form');
    res.redirect('/faculty/courses');
  }
}));

router.post('/courses/new', asyncHandler(async (req, res) => {
  try {
    const { title, code, description, type, maxStudents, semester, department, credits } = req.body;

    const courseExists = await Course.findOne({ code });
    if (courseExists) {
      req.flash('error', 'Course code already exists');
      return res.redirect('/faculty/courses/new');
    }

    const course = new Course({
      title,
      code,
      description,
      instructor: req.user._id,
      type,
      maxStudents,
      semester,
      department,
      credits,
      status: 'active'
    });

    await course.save();
    req.flash('success', 'Course created successfully');
    res.redirect(`/faculty/courses/${course._id}`);
  } catch (error) {
    console.error('Create Course Error:', error);
    req.flash('error', 'Error creating course');
    res.redirect('/faculty/courses/new');
  }
}));

router.get('/courses/:id', asyncHandler(async (req, res) => {
  try {
    const course = await Course.findOne({
      _id: req.params.id,
      instructor: req.user._id
    }).populate('students')
      .populate('assignments')
      .populate('attendance');

    if (!course) {
      req.flash('error', 'Course not found');
      return res.redirect('/faculty/dashboard');
    }

    res.render('faculty/course-management', {
      title: 'Course Management',
      user: req.user,
      course
    });
  } catch (error) {
    console.error('Course Management Error:', error);
    req.flash('error', 'Error loading course');
    res.redirect('/faculty/courses');
  }
}));

// Course Content Routes
router.post('/courses/:id/content', upload.array('files', 5), asyncHandler(async (req, res) => {
  try {
    const { title, type, description, dueDate } = req.body;
    const files = req.files.map(file => `/uploads/course-content/${file.filename}`);

    const course = await Course.findOne({
      _id: req.params.id,
      instructor: req.user._id
    });

    if (!course) {
      req.flash('error', 'Course not found');
      return res.redirect('/faculty/dashboard');
    }

    course.content.push({
      title,
      type,
      description,
      attachments: files,
      dueDate: dueDate || null,
      isPublished: true,
      publishDate: new Date()
    });

    await course.save();
    req.flash('success', 'Content added successfully');
    res.redirect(`/faculty/courses/${req.params.id}`);
  } catch (error) {
    console.error('Add Content Error:', error);
    req.flash('error', 'Error adding content');
    res.redirect(`/faculty/courses/${req.params.id}`);
  }
}));

// Assignment Routes
router.get('/assignments/new', asyncHandler(async (req, res) => {
  try {
    const courses = await Course.find({ instructor: req.user._id });
    res.render('faculty/assignment-form', {
      title: 'Create New Assignment',
      user: req.user,
      courses
    });
  } catch (error) {
    console.error('New Assignment Form Error:', error);
    req.flash('error', 'Error loading assignment form');
    res.redirect('/faculty/courses');
  }
}));

router.post('/assignments/new', asyncHandler(async (req, res) => {
  try {
    const { title, description, dueDate, testCases, courseId } = req.body;

    const course = await Course.findOne({
      _id: courseId,
      instructor: req.user._id
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const assignment = new Assignment({
      title,
      description,
      type: 'coding',
      course: courseId,
      dueDate,
      testCases: JSON.parse(testCases)
    });

    await assignment.save();
    course.assignments.push(assignment._id);
    await course.save();

    res.json({ success: true, assignmentId: assignment._id });
  } catch (error) {
    console.error('Create Assignment Error:', error);
    res.status(500).json({ error: 'Error creating assignment' });
  }
}));

// Attendance Routes
router.post('/attendance/mark', asyncHandler(async (req, res) => {
  try {
    const { courseId, date, attendance } = req.body;

    const course = await Course.findOne({
      _id: courseId,
      instructor: req.user._id
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const attendanceRecord = new Attendance({
      course: courseId,
      date: new Date(date),
      students: Object.entries(attendance).map(([studentId, status]) => ({
        student: studentId,
        status,
        markedBy: req.user._id,
        markedAt: new Date()
      }))
    });

    await attendanceRecord.save();
    course.attendance.push(attendanceRecord._id);
    await course.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Mark Attendance Error:', error);
    res.status(500).json({ error: 'Error marking attendance' });
  }
}));

// Analytics Routes
router.get('/courses/:id/analytics', asyncHandler(async (req, res) => {
  try {
    const course = await Course.findOne({
      _id: req.params.id,
      instructor: req.user._id
    }).populate('students')
      .populate('assignments')
      .populate('attendance');

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const analytics = {
      totalStudents: course.students.length,
      averageAttendance: calculateAverageAttendance(course.attendance),
      assignmentCompletion: calculateAssignmentCompletion(course.assignments, course.students),
      performanceDistribution: generatePerformanceDistribution(course.assignments, course.students),
      weeklyEngagement: await calculateWeeklyEngagement(course._id)
    };

    res.json(analytics);
  } catch (error) {
    console.error('Analytics Error:', error);
    res.status(500).json({ error: 'Error generating analytics' });
  }
}));

// Helper Functions
async function generateCourseAnalytics(courses) {
  const analytics = {
    totalStudents: 0,
    averagePerformance: 0,
    courseEngagement: [],
    recentSubmissions: []
  };

  courses.forEach(course => {
    analytics.totalStudents += course.students.length;
  });

  return analytics;
}

function calculateAverageAttendance(attendance) {
  if (!attendance.length) return 0;
  const present = attendance.reduce((total, record) => {
    return total + record.students.filter(s => s.status === 'present').length;
  }, 0);
  return (present / (attendance.length * attendance[0].students.length)) * 100;
}

function calculateAssignmentCompletion(assignments, students) {
  const totalAssignments = assignments.length;
  const studentCompletions = {};

  assignments.forEach(assignment => {
    assignment.submissions.forEach(submission => {
      studentCompletions[submission.student] = (studentCompletions[submission.student] || 0) + 1;
    });
  });

  return Object.values(studentCompletions).map(completed => 
    (completed / totalAssignments) * 100
  );
}

function generatePerformanceDistribution(assignments, students) {
  const distribution = {
    '0-20': 0,
    '21-40': 0,
    '41-60': 0,
    '61-80': 0,
    '81-100': 0
  };

  students.forEach(student => {
    const scores = assignments.map(assignment => {
      const submission = assignment.submissions.find(s => 
        s.student.toString() === student._id.toString()
      );
      return submission ? submission.totalScore : 0;
    });

    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    
    if (avgScore <= 20) distribution['0-20']++;
    else if (avgScore <= 40) distribution['21-40']++;
    else if (avgScore <= 60) distribution['41-60']++;
    else if (avgScore <= 80) distribution['61-80']++;
    else distribution['81-100']++;
  });

  return distribution;
}

async function calculateWeeklyEngagement(courseId) {
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

  const course = await Course.findById(courseId)
    .populate({
      path: 'assignments',
      match: {
        'submissions.submittedAt': { $gte: fourWeeksAgo }
      }
    });

  const weeklyData = Array(4).fill(0);
  
  course.assignments.forEach(assignment => {
    assignment.submissions.forEach(submission => {
      const weekIndex = Math.floor(
        (new Date() - submission.submittedAt) / (7 * 24 * 60 * 60 * 1000)
      );
      if (weekIndex >= 0 && weekIndex < 4) {
        weeklyData[weekIndex]++;
      }
    });
  });

  return weeklyData.reverse();
}

module.exports = router;