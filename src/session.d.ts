import 'express-session';

declare module 'express-session' {
  interface SessionData {
    adminUsername?: string;
    oauthState?: string;
  }
}