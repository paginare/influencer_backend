import { Request, Response, NextFunction } from 'express';

// Define a type for the async function we want to wrap
type AsyncFunction = (req: Request, res: Response, next: NextFunction) => Promise<any>;

// Wrapper function to handle errors in async middleware/controllers
const asyncHandler = (fn: AsyncFunction) => (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler; 