'use strict';
/**
 * Unit Test: responseHandler utility
 */
const { successResponse, errorResponse, paginationResponse } = require('../../../src/utils/responseHandler');

describe('responseHandler', () => {
  describe('successResponse', () => {
    test('memiliki field success=true, statusCode, message, data', () => {
      const resp = successResponse({ id: 1 }, 'Created', 201);
      expect(resp.success).toBe(true);
      expect(resp.statusCode).toBe(201);
      expect(resp.message).toBe('Created');
      expect(resp.data).toEqual({ id: 1 });
    });

    test('default statusCode 200 jika tidak diberikan', () => {
      const resp = successResponse({ id: 1 });
      expect(resp.statusCode).toBe(200);
    });
  });

  describe('errorResponse', () => {
    test('memiliki field success=false, statusCode, message', () => {
      const resp = errorResponse('Not Found', 404);
      expect(resp.success).toBe(false);
      expect(resp.statusCode).toBe(404);
      expect(resp.message).toBe('Not Found');
    });

    test('menyertakan errors jika diberikan', () => {
      const errs = [{ field: 'email', message: 'Invalid' }];
      const resp = errorResponse('Validation Error', 422, errs);
      expect(resp.errors).toEqual(errs);
    });
  });

  describe('paginationResponse', () => {
    test('memiliki pagination metadata yang benar', () => {
      const resp = paginationResponse([1, 2, 3], 1, 10, 25);
      expect(resp.pagination.currentPage).toBe(1);
      expect(resp.pagination.pageSize).toBe(10);
      expect(resp.pagination.totalItems).toBe(25);
      expect(resp.pagination.totalPages).toBe(3);
    });

    test('menghitung totalPages dengan benar', () => {
      const resp = paginationResponse([], 2, 5, 11);
      // 11 / 5 = 2.2 → ceil = 3
      expect(resp.pagination.totalPages).toBe(3);
    });
  });
});
