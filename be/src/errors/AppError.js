export class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Yêu cầu không hợp lệ") {
    super(message, 400);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Không tìm thấy tài nguyên") {
    super(message, 404);
  }
}

export class MethodNotAllowedError extends AppError {
  constructor(message = "Phương thức không được hỗ trợ") {
    super(message, 405);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Đang có lần chạy khác, thử lại sau") {
    super(message, 409);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message = "Không thể xử lý yêu cầu") {
    super(message, 422);
  }
}

export class BadGatewayError extends AppError {
  constructor(message = "Lỗi phản hồi từ dịch vụ ngoài") {
    super(message, 502);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Dịch vụ tạm thời không khả dụng") {
    super(message, 503);
  }
}

