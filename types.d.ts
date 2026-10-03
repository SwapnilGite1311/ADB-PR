import type { User } from './models';
import 'express-session';

declare global {
    namespace Express {
        interface Request {
            user: InstanceType<typeof User>;
        }
    }
}
declare module 'express-session' {
    interface SessionData {
        userId?: string;
    }
}
