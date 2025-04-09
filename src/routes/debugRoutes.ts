import express from 'express';
import { protect, admin } from '../middlewares/authMiddleware';
import asyncHandler from '../utils/asyncHandler';
import { AuthRequest } from '../middlewares/authMiddleware'; // Import AuthRequest if needed for req.user type
import { sendScheduledReports } from '../jobs/reportScheduler'; // Import the function

const router = express.Router();

// @desc    Manually trigger the scheduled report job
// @route   POST /api/debug/trigger-reports
// @access  Private/Admin
router.post('/trigger-reports', protect, admin, asyncHandler(async (req: AuthRequest, res) => {
    // Log who triggered it
    console.log(`[API DEBUG /trigger-reports] Trigger manual do job de relatórios solicitado por: ${req.user?.email || 'ID: ' + req.user?._id}`);
    
    try {
        // Execute the core logic of the scheduled job
        await sendScheduledReports(); 
        
        console.log("[API DEBUG /trigger-reports] Job executado manualmente com sucesso.");
        res.json({ success: true, message: 'Job de relatórios executado manualmente.' });

    } catch (error) {
        console.error("[API DEBUG /trigger-reports] Erro ao executar job manualmente:", error);
        res.status(500).json({ success: false, message: 'Erro interno ao executar job manualmente.' });
    }
}));

// Add more debug routes here if needed

export default router; 