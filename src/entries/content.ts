import '../content.css';
// Order matters: the API must exist before bundled providers register, and contentStart.js closes registration.
import './content-api';
import './bundled-providers-isolated';
