/**
 * Response Handler Utility
 * Standarisasi format response API
 */

// Success response
const successResponse = (data, message = 'Success', statusCode = 200) => {
  return {
    success: true,
    statusCode,
    message,
    data
  };
};

// Error response
const errorResponse = (message = 'Error', statusCode = 500, errors = null) => {
  const response = {
    success: false,
    statusCode,
    message
  };

  if (errors) {
    response.errors = errors;
  }

  return response;
};

// Pagination response
const paginationResponse = (data, page, limit, total, message = 'Success') => {
  return {
    success: true,
    statusCode: 200,
    message,
    data,
    pagination: {
      currentPage: parseInt(page),
      pageSize: parseInt(limit),
      totalItems: total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

module.exports = {
  successResponse,
  errorResponse,
  paginationResponse
};
