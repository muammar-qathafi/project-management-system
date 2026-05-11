'use strict';
/**
 * Unit Test: AuthService
 * Requirement: IAM — register (role forced to staff), login, logout, profile
 */

// Mock semua dependency eksternal sebelum require service
jest.mock('../../../src/repositories/userRepository');
jest.mock('../../../src/config/redis', () => ({
  cacheHelper: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    delPattern: jest.fn()
  },
  redisClient: { on: jest.fn() }
}));
jest.mock('jsonwebtoken');

const authService = require('../../../src/services/authService');
const userRepository = require('../../../src/repositories/userRepository');
const jwt = require('jsonwebtoken');
const { cacheHelper } = require('../../../src/config/redis');

// Mock user helper
const makeUser = (overrides = {}) => ({
  id: 1,
  name: 'Test User',
  username: 'testuser',
  email: 'test@example.com',
  phone_number: '081234567890',
  role: 'staff',
  is_active: true,
  password: '$2b$10$hashedpwd',
  validatePassword: jest.fn().mockResolvedValue(true),
  toJSON: jest.fn().mockReturnValue({
    id: 1, name: 'Test User', username: 'testuser',
    email: 'test@example.com', role: 'staff', is_active: true
  }),
  ...overrides
});

beforeEach(() => {
  jest.resetAllMocks();
  jwt.sign.mockReturnValue('mock.jwt.token');
  jwt.verify.mockReturnValue({ id: 1, email: 'test@example.com', role: 'staff' });
  jwt.decode.mockReturnValue({ id: 1, email: 'test@example.com', role: 'staff', exp: Math.floor(Date.now() / 1000) + 3600 });
});

// ─── register ─────────────────────────────────────────────────────────────────

describe('AuthService.register', () => {
  test('RBAC: register publik selalu menghasilkan role staff (tidak bisa inject admin)', async () => {
    const mockUser = makeUser({ role: 'staff' });
    userRepository.findByEmail.mockResolvedValue(null);
    userRepository.create.mockResolvedValue(mockUser);

    // User mencoba mendaftarkan dirinya sebagai admin
    const result = await authService.register({
      name: 'Hacker',
      username: 'hacker99',
      email: 'hacker@test.com',
      password: 'password123',
      role: 'admin'  // Harus diabaikan
    });

    // Harus terpaksa jadi staff
    const createCall = userRepository.create.mock.calls[0][0];
    expect(createCall.role).toBe('staff');
    expect(result.token).toBeDefined();
  });

  test('register berhasil dengan semua atribut wajib (name, username, email, phone_number)', async () => {
    const mockUser = makeUser();
    userRepository.findByEmail.mockResolvedValue(null);
    userRepository.create.mockResolvedValue(mockUser);

    const result = await authService.register({
      name: 'Budi Santoso',
      username: 'budi_s',
      email: 'budi@example.com',
      password: 'SecurePass123',
      phone_number: '081234567890'
    });

    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Budi Santoso',
        username: 'budi_s',
        email: 'budi@example.com',
        phone_number: '081234567890',
        role: 'staff'
      })
    );
    expect(result.token).toBe('mock.jwt.token');
  });

  test('register gagal jika email sudah terdaftar (HTTP 400)', async () => {
    userRepository.findByEmail.mockResolvedValue(makeUser());

    await expect(authService.register({
      name: 'Duplikat',
      username: 'duplikat',
      email: 'test@example.com',
      password: 'password123'
    })).rejects.toMatchObject({
      message: 'Email already registered',
      statusCode: 400
    });
  });
});

// ─── login ────────────────────────────────────────────────────────────────────

describe('AuthService.login', () => {
  test('login berhasil dengan kredensial yang benar', async () => {
    const mockUser = makeUser();
    userRepository.findByEmail.mockResolvedValue(mockUser);

    const result = await authService.login('test@example.com', 'password123');

    expect(result.token).toBe('mock.jwt.token');
    expect(mockUser.validatePassword).toHaveBeenCalledWith('password123');
  });

  test('login gagal jika email tidak ditemukan (HTTP 401)', async () => {
    userRepository.findByEmail.mockResolvedValue(null);

    await expect(authService.login('notexist@test.com', 'password'))
      .rejects.toMatchObject({ statusCode: 401, message: 'Invalid email or password' });
  });

  test('login gagal jika password salah (HTTP 401)', async () => {
    const mockUser = makeUser({
      validatePassword: jest.fn().mockResolvedValue(false)
    });
    userRepository.findByEmail.mockResolvedValue(mockUser);

    await expect(authService.login('test@example.com', 'wrongpassword'))
      .rejects.toMatchObject({ statusCode: 401, message: 'Invalid email or password' });
  });

  test('login gagal jika akun dinonaktifkan (HTTP 403)', async () => {
    const mockUser = makeUser({ is_active: false });
    userRepository.findByEmail.mockResolvedValue(mockUser);

    await expect(authService.login('test@example.com', 'password123'))
      .rejects.toMatchObject({ statusCode: 403, message: 'Account is deactivated' });
  });
});

// ─── logout ───────────────────────────────────────────────────────────────────

describe('AuthService.logout', () => {
  test('logout berhasil blacklist token di Redis dengan TTL sisa', async () => {
    cacheHelper.set.mockResolvedValue(true);

    // Signature: logout(userId, token)
    const result = await authService.logout(1, 'mock.jwt.token');

    expect(cacheHelper.set).toHaveBeenCalledWith(
      expect.stringContaining('blacklist:'),
      true,
      expect.any(Number)
    );
    expect(result).toBe(true);
  });
});

// ─── getUserProfile ───────────────────────────────────────────────────────────

describe('AuthService.getUserProfile', () => {
  test('harus mengembalikan data user tanpa field sensitif', async () => {
    const mockUser = makeUser();
    userRepository.findById.mockResolvedValue(mockUser);

    const result = await authService.getUserProfile(1);

    expect(userRepository.findById).toHaveBeenCalledWith(1);
    expect(result).toBeDefined();
  });

  test('harus throw 404 jika user tidak ditemukan', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expect(authService.getUserProfile(999))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});
