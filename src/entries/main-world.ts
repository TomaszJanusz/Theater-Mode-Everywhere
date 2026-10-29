// Order matters: the API must exist before bundled providers register, and mainWorldStart.js closes registration.
import './main-world-api';
import './bundled-providers-main';
