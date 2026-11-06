import { wrapApp } from '../app/story-support.js';
import '../icons/VseIcon.js';
import './CheckUi.js';
import './PriorConclusion.js';
import './check-ui.css';
import './prior-conclusion.css';

export const check = globalThis.VseCheck;
export const wrapCheck = (element, className = '') => wrapApp(element, `vse-check-ui check-story-preview ${className}`.trim());
