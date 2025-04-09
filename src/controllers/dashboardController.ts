import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AuthRequest } from '../middlewares/authMiddleware';
import Sale from '../models/Sale';
import User, { UserRole } from '../models/User';
import CommissionPayment from '../models/CommissionPayment';
import mongoose from 'mongoose';

// Helper function to calculate start/end dates based on period
const getDateRange = (period: 'month' | 'quarter' | 'year'): { startDate: Date, endDate: Date, prevStartDate: Date, prevEndDate: Date } => {
    const now = new Date();
    let startDate: Date, endDate: Date, prevStartDate: Date, prevEndDate: Date;

    endDate = new Date(now); // End date is always now for current period
    prevEndDate = new Date(now); // Initialize prevEndDate

    switch (period) {
        case 'year':
            startDate = new Date(now.getFullYear(), 0, 1);
            prevStartDate = new Date(now.getFullYear() - 1, 0, 1);
            prevEndDate = new Date(now.getFullYear(), 0, 0); // End of previous year
            break;
        case 'quarter':
            const currentQuarter = Math.floor(now.getMonth() / 3);
            startDate = new Date(now.getFullYear(), currentQuarter * 3, 1);
            const prevQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1;
            const prevQuarterYear = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
            prevStartDate = new Date(prevQuarterYear, prevQuarter * 3, 1);
            prevEndDate = new Date(now.getFullYear(), currentQuarter * 3, 0); // End of previous quarter
            break;
        case 'month':
        default:
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            prevEndDate = new Date(now.getFullYear(), now.getMonth(), 0); // End of previous month
            break;
    }
    
    return { startDate, endDate, prevStartDate, prevEndDate };
};

// @desc    Get Performance Overview Stats
// @route   GET /api/dashboard/performance-overview
// @access  Private/Admin
const getPerformanceOverviewStats = asyncHandler(async (req: AuthRequest, res: Response) => {
    const period = (req.query.period as 'month' | 'quarter' | 'year') || 'month';
    const userType = (req.query.userType as 'all' | 'manager' | 'influencer') || 'all';

    const { startDate, endDate, prevStartDate, prevEndDate } = getDateRange(period);

    let userFilter: any = {};
    if (userType === 'manager') {
        userFilter.role = UserRole.MANAGER;
    } else if (userType === 'influencer') {
        userFilter.role = UserRole.INFLUENCER;
    }
    // 'all' means no role filter

    // --- Calculate Current Period Stats ---    
    // Define match criteria based on date and user type
    let salesMatch: any = { createdAt: { $gte: startDate, $lt: endDate } };
    if (userType === 'influencer') {
        salesMatch.influencerId = { $exists: true, $ne: null };
    } else if (userType === 'manager') {
        // Assuming sales related to a manager are those made by their influencers
        // This requires fetching manager's influencers first, might be complex here
        // Simpler approach: filter by managerId being present if that field exists on Sale model
        // salesMatch.managerId = { $exists: true, $ne: null }; 
        // OR, if manager sales are direct, maybe filter by user role on Sale if exists?
        // For now, let's stick to filtering by influencer sales if userType is influencer
    }

    const currentSales = await Sale.aggregate([
        { $match: salesMatch }, // Apply combined match criteria
        { $group: { 
            _id: null, 
            totalSalesValue: { $sum: '$saleValue' }, // <-- Corrected field name
            totalSalesCount: { $sum: 1 },
            totalInfluencerCommission: { $sum: '$influencerCommissionEarned' }, // <-- Verify field name in Sale model
            totalManagerCommission: { $sum: '$managerCommissionEarned' } // <-- Verify field name in Sale model
        } }
    ]);
    
    // --- Calculate Previous Period Stats (for growth) ---   
    let prevSalesMatch: any = { createdAt: { $gte: prevStartDate, $lt: prevEndDate } };
    if (userType === 'influencer') {
        prevSalesMatch.influencerId = { $exists: true, $ne: null };
    } else if (userType === 'manager') {
        // Apply similar logic as above if needed
        // prevSalesMatch.managerId = { $exists: true, $ne: null }; 
    }

    const previousSales = await Sale.aggregate([
        { $match: prevSalesMatch }, // Apply combined match criteria
        { $group: { 
            _id: null, 
            totalSalesValue: { $sum: '$saleValue' }, // <-- Corrected field name
            totalSalesCount: { $sum: 1 },
            totalInfluencerCommission: { $sum: '$influencerCommissionEarned' }, // <-- Verify field name
            totalManagerCommission: { $sum: '$managerCommissionEarned' } // <-- Verify field name
        } }
    ]);

    // --- Calculate User Stats ---  
    const userStatsQuery = { 
        createdAt: { $lte: endDate }, // Users created before or during the period
        isActive: true, // Consider only active users
        ...userFilter 
    };
    const activeUserCount = await User.countDocuments(userStatsQuery);

    // --- Combine and Calculate --- 
    const currentStats = currentSales[0] || { totalSalesValue: 0, totalSalesCount: 0, totalInfluencerCommission: 0, totalManagerCommission: 0 };
    const previousStats = previousSales[0] || { totalSalesValue: 0, totalSalesCount: 0, totalInfluencerCommission: 0, totalManagerCommission: 0 };
    
    let totalCommissions = 0;
    let prevTotalCommissions = 0;
    if(userType === 'influencer') {
        totalCommissions = currentStats.totalInfluencerCommission;
        prevTotalCommissions = previousStats.totalInfluencerCommission;
    } else if (userType === 'manager') {
        totalCommissions = currentStats.totalManagerCommission;
        prevTotalCommissions = previousStats.totalManagerCommission;
    } else { // 'all'
        totalCommissions = currentStats.totalInfluencerCommission + currentStats.totalManagerCommission;
        prevTotalCommissions = previousStats.totalInfluencerCommission + previousStats.totalManagerCommission;
    }

    const calculateGrowth = (current: number, previous: number): number => {
        if (previous === 0) return current > 0 ? Infinity : 0; // Handle division by zero
        return parseFloat((((current - previous) / previous) * 100).toFixed(1));
    };

    const salesGrowth = calculateGrowth(currentStats.totalSalesValue, previousStats.totalSalesValue);
    const commissionGrowth = calculateGrowth(totalCommissions, prevTotalCommissions);
    
    // Conversion rate might need a more specific definition (e.g., sales per active user)
    // Placeholder calculation
    const conversionRate = activeUserCount > 0 ? parseFloat(((currentStats.totalSalesCount / activeUserCount) * 100).toFixed(1)) : 0;

    res.json({
        totalSales: currentStats.totalSalesValue,
        salesGrowth: isFinite(salesGrowth) ? salesGrowth : 100.0, // Handle Infinity case for display
        totalCommissions: totalCommissions,
        commissionGrowth: isFinite(commissionGrowth) ? commissionGrowth : 100.0, // Handle Infinity
        activeUsers: activeUserCount,
        conversionRate: conversionRate,
    });
});

// @desc    Get Performance Timeline Data
// @route   GET /api/dashboard/performance-timeline
// @access  Private/Admin
const getPerformanceTimeline = asyncHandler(async (req: AuthRequest, res: Response) => {
    const period = (req.query.period as 'year' | 'all') || 'year'; // Default to year

    let matchDate: any = {};
    if (period === 'year') {
        const startOfYear = new Date(new Date().getFullYear(), 0, 1);
        matchDate = { $gte: startOfYear };
    }
    // 'all' means no date filter

    const salesTimeline = await Sale.aggregate([
        {
            $match: { createdAt: matchDate } // Apply date filter
        },
        {
            $project: { // Project needed fields and the grouping key (month)
                month: { $month: "$createdAt" }, // Extract month number
                year: { $year: "$createdAt" }, // Extract year
                amount: "$amount",
                // Determine if the sale is primarily manager or influencer driven
                // This logic might need refinement based on your commission structure
                isManagerSale: { $cond: [ { $gt: ["$managerCommission", 0] }, 1, 0 ] }, // Count if manager got commission
                isInfluencerSale: { $cond: [ { $gt: ["$influencerCommission", 0] }, 1, 0 ] } // Count if influencer got commission
            }
        },
        {
            $group: {
                _id: { year: "$year", month: "$month" }, // Group by year-month
                managerSales: { 
                    $sum: { $cond: [ { $eq: ["$isManagerSale", 1] }, "$amount", 0 ] } 
                },
                influencerSales: { 
                    $sum: { $cond: [ { $eq: ["$isInfluencerSale", 1] }, "$amount", 0 ] } 
                },
            }
        },
        {
            $sort: { "_id.year": 1, "_id.month": 1 } // Sort chronologically
        },
        {
            $project: { // Format the output
                _id: 0,
                month: { // Convert month number to name (optional, can be done frontend)
                    $let: {
                        vars: {
                            monthsInYear: ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
                        },
                        in: { $arrayElemAt: [ "$$monthsInYear", "$_id.month" ] }
                    }
                },
                year: "$_id.year", // Include year if needed
                managerSales: "$managerSales",
                influencersSales: "$influencerSales" // Corrected key name
            }
        }
    ]);

    res.json(salesTimeline);
});

export {
    getPerformanceOverviewStats,
    getPerformanceTimeline,
    // Add other dashboard controller functions here if they exist or are created
}; 