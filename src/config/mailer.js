const nodemailer = require('nodemailer');
require('dotenv').config();

// Konfigurasi NodeMailer untuk mengirim email
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  secure: process.env.MAIL_SECURE === 'true',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASSWORD
  }
});

// Verify transporter configuration
const verifyMailer = async () => {
  try {
    await transporter.verify();
    console.log('✓ Mailer is ready to send emails');
  } catch (error) {
    console.error('✗ Mailer verification failed:', error.message);
  }
};

// Send email helper
const sendEmail = async ({ to, subject, text, html }) => {
  try {
    const mailOptions = {
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to,
      subject,
      text,
      html
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error.message);
    return { success: false, error: error.message };
  }
};

// Email templates
const emailTemplates = {
  // Notifikasi task overdue
  taskOverdue: (task, user) => ({
    subject: `[Overdue] Task: ${task.title}`,
    text: [
      `Hello ${user.name},`,
      ``,
      `Your task "${task.title}" has passed its due date and has been marked as Overdue.`,
      `Due Date : ${new Date(task.due_date).toLocaleString()}`,
      `Priority : ${task.priority}`,
      ``,
      `Please update the task status or contact your manager.`,
    ].join('\n'),
    html: `
      <div style="font-family:sans-serif;max-width:600px">
        <h2 style="color:#c0392b">&#9888; Task Overdue</h2>
        <p>Hello <strong>${user.name}</strong>,</p>
        <p>The following task has passed its due date and is now marked as <strong>Overdue</strong>:</p>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:6px;font-weight:bold">Task</td><td style="padding:6px">${task.title}</td></tr>
          <tr><td style="padding:6px;font-weight:bold">Due Date</td><td style="padding:6px">${new Date(task.due_date).toLocaleString()}</td></tr>
          <tr><td style="padding:6px;font-weight:bold">Priority</td><td style="padding:6px">${task.priority}</td></tr>
        </table>
        <p>Please update the task status or contact your manager.</p>
      </div>
    `
  }),

  // Notifikasi task di-assign ke user
  taskAssigned: (task, assignee, assigner) => ({
    subject: `[Assigned] Task: ${task.title}`,
    text: [
      `Hello ${assignee.name},`,
      ``,
      `A new task has been assigned to you by ${assigner ? assigner.name : 'a manager'}.`,
      ``,
      `Task    : ${task.title}`,
      `Priority: ${task.priority}`,
      `Due Date: ${task.due_date ? new Date(task.due_date).toLocaleString() : 'Not set'}`,
      ``,
      task.description ? `Description:\n${task.description}` : '',
      ``,
      `Please log in to the Project Management System for more details.`,
    ].join('\n'),
    html: `
      <div style="font-family:sans-serif;max-width:600px">
        <h2 style="color:#2980b9">&#128203; New Task Assigned</h2>
        <p>Hello <strong>${assignee.name}</strong>,</p>
        <p>A new task has been assigned to you by <strong>${assigner ? assigner.name : 'a manager'}</strong>.</p>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:6px;font-weight:bold">Task</td><td style="padding:6px">${task.title}</td></tr>
          <tr><td style="padding:6px;font-weight:bold">Priority</td><td style="padding:6px">${task.priority}</td></tr>
          <tr><td style="padding:6px;font-weight:bold">Due Date</td><td style="padding:6px">${task.due_date ? new Date(task.due_date).toLocaleString() : 'Not set'}</td></tr>
          ${task.description ? `<tr><td style="padding:6px;font-weight:bold">Description</td><td style="padding:6px">${task.description}</td></tr>` : ''}
        </table>
        <p>Please log in to the Project Management System for more details.</p>
      </div>
    `
  }),

  // Welcome email
  welcome: (user) => ({
    subject: 'Welcome to Project Management System',
    text: `Hello ${user.name},\n\nWelcome to our Project Management System!\nYour account has been created successfully.`,
    html: `
      <div style="font-family:sans-serif;max-width:600px">
        <h2 style="color:#27ae60">Welcome to Project Management System</h2>
        <p>Hello <strong>${user.name}</strong>,</p>
        <p>Your account has been created successfully. You can now log in and start managing your projects.</p>
      </div>
    `
  })
};

module.exports = {
  transporter,
  verifyMailer,
  sendEmail,
  emailTemplates
};
