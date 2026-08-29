// Система управления администраторами
class AdminAuth {
  constructor() {
    this.admins = this.loadAdmins();
    this.initializeDefaultAdmin();
  }

  // Инициализация первоначального админа
  initializeDefaultAdmin() {
    const defaultAdmin = {
      id: 'super-admin-001',
      login: 'admin',
      password: this.hashPassword('admin123'),
      name: 'Главный администратор',
      role: 'super_admin', // super_admin, organizer
      createdAt: '2024-01-01T00:00:00.000Z',
      isActive: true
    };

    // Проверяем, есть ли уже главный админ
    const existingSuperAdmin = this.admins.find(admin => admin.role === 'super_admin');
    if (!existingSuperAdmin) {
      this.admins.push(defaultAdmin);
      this.saveAdmins();
    }
  }

  // Загрузка администраторов из localStorage
  loadAdmins() {
    const stored = localStorage.getItem('survey_admins');
    return stored ? JSON.parse(stored) : [];
  }

  // Сохранение администраторов в localStorage
  saveAdmins() {
    localStorage.setItem('survey_admins', JSON.stringify(this.admins));
  }

  // Регистрация нового организатора (только для суперадмина)
  registerOrganizer(login, password, name, createdBy) {
    // Проверяем, что создатель - суперадмин
    const creator = this.admins.find(admin => admin.id === createdBy);
    if (!creator || creator.role !== 'super_admin') {
      throw new Error('Только главный администратор может создавать организаторов');
    }

    // Проверка, что логин не занят
    if (this.admins.find(admin => admin.login === login)) {
      throw new Error('Организатор с таким логином уже существует');
    }

    // Проверка сложности пароля
    if (password.length < 6) {
      throw new Error('Пароль должен содержать минимум 6 символов');
    }

    // Создание нового организатора
    const newOrganizer = {
      id: Date.now().toString(),
      login: login.toLowerCase(),
      password: this.hashPassword(password),
      name: name,
      role: 'organizer',
      createdAt: new Date().toISOString(),
      createdBy: createdBy,
      isActive: true
    };

    this.admins.push(newOrganizer);
    this.saveAdmins();
    
    return {
      success: true,
      admin: { ...newOrganizer, password: undefined }
    };
  }

  // Авторизация администратора
  loginAdmin(login, password) {
    const admin = this.admins.find(admin => 
      admin.login === login.toLowerCase() && 
      admin.isActive
    );

    if (!admin) {
      throw new Error('Администратор не найден');
    }

    if (admin.password !== this.hashPassword(password)) {
      throw new Error('Неверный пароль');
    }

    // Создаем сессию
    const session = {
      adminId: admin.id,
      login: admin.login,
      name: admin.name,
      role: admin.role,
      loginTime: new Date().toISOString(),
      token: this.generateToken()
    };

    localStorage.setItem('admin_session', JSON.stringify(session));
    
    return {
      success: true,
      admin: { ...admin, password: undefined },
      session
    };
  }

  // Проверка авторизации администратора
  isAdminLoggedIn() {
    const session = localStorage.getItem('admin_session');
    if (!session) return false;

    try {
      const sessionData = JSON.parse(session);
      const admin = this.admins.find(admin => admin.id === sessionData.adminId);
      return admin && admin.isActive;
    } catch {
      return false;
    }
  }

  // Получение данных текущего администратора
  getCurrentAdmin() {
    const session = localStorage.getItem('admin_session');
    if (!session) return null;

    try {
      const sessionData = JSON.parse(session);
      const admin = this.admins.find(admin => admin.id === sessionData.adminId);
      return admin ? { ...admin, password: undefined } : null;
    } catch {
      return null;
    }
  }

  // Проверка, является ли текущий админ суперадмином
  isCurrentUserSuperAdmin() {
    const currentAdmin = this.getCurrentAdmin();
    return currentAdmin && currentAdmin.role === 'super_admin';
  }

  // Выход администратора
  logoutAdmin() {
    localStorage.removeItem('admin_session');
  }

  // Выход администратора (алиас для совместимости)
  logout() {
    this.logoutAdmin();
  }

  // Получение списка всех администраторов (только для суперадмина)
  getAllAdmins() {
    const currentAdmin = this.getCurrentAdmin();
    if (!currentAdmin || currentAdmin.role !== 'super_admin') {
      throw new Error('Доступ запрещен');
    }
    return this.admins.map(admin => ({ ...admin, password: undefined }));
  }

  // Получение списка организаторов (для суперадмина)
  getOrganizers() {
    const currentAdmin = this.getCurrentAdmin();
    if (!currentAdmin || currentAdmin.role !== 'super_admin') {
      throw new Error('Доступ запрещен');
    }
    return this.admins
      .filter(admin => admin.role === 'organizer')
      .map(admin => ({ ...admin, password: undefined }));
  }

  // Получение списка организаторов с паролями (для суперадмина)
  getOrganizersWithPasswords() {
    const currentAdmin = this.getCurrentAdmin();
    if (!currentAdmin || currentAdmin.role !== 'super_admin') {
      throw new Error('Доступ запрещен');
    }
    return this.admins
      .filter(admin => admin.role === 'organizer')
      .map(admin => ({ 
        ...admin, 
        password: this.dehashPassword(admin.password) 
      }));
  }

  // Расшифровка пароля (обратная операция к hashPassword)
  dehashPassword(hashedPassword) {
    try {
      const decoded = atob(hashedPassword);
      return decoded.replace('survey_salt_2024', '');
    } catch {
      return 'Ошибка расшифровки';
    }
  }

  // Удаление администратора (только суперадмин может удалять организаторов)
  deleteAdmin(adminId) {
    const currentAdmin = this.getCurrentAdmin();
    if (!currentAdmin || currentAdmin.role !== 'super_admin') {
      throw new Error('Доступ запрещен');
    }

    const adminToDelete = this.admins.find(admin => admin.id === adminId);
    if (!adminToDelete) {
      throw new Error('Администратор не найден');
    }

    if (adminToDelete.role === 'super_admin') {
      throw new Error('Нельзя удалить главного администратора');
    }

    this.admins = this.admins.filter(admin => admin.id !== adminId);
    this.saveAdmins();
  }

  // Простое хеширование пароля (в реальном проекте используйте bcrypt)
  hashPassword(password) {
    return btoa(password + 'survey_salt_2024');
  }

  // Генерация токена сессии
  generateToken() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  // Валидация логина
  validateLogin(login) {
    return login.length >= 3 && /^[a-zA-Z0-9_]+$/.test(login);
  }

  // Валидация пароля
  validatePassword(password) {
    return password.length >= 6;
  }
}

// Создаем единственный экземпляр
const adminAuth = new AdminAuth();

export default adminAuth; 