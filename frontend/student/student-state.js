const API_BASE = "http://127.0.0.1:8000";

let currentUser = null;
let currentCourseId = null;
let currentScenarioId = null;
let currentScenarios = [];
let currentAttempts = [];
let currentSubmissions = [];
let latestAttemptMap = {};
let customLabTemplatesMap = {};
let pollTimer = null;
window._labCountdownInterval = null;