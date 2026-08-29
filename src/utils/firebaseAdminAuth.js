import { db } from '../firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where
} from 'firebase/firestore';

const adminsCol = collection(db, 'admins');

class FirebaseAdminAuth {
  constructor() {
    this.currentAdmin = null;
    this.firebaseAvailable = true;
    this.initializeDefaultAdmin();
  }

  // Проверка доступности Firebase
  async checkFirebaseConnection() {
    try {
      await getDocs(adminsCol);
      this.firebaseAvailable = true;
      return true;
    } catch (error) {
      console.warn('Firebase недоступен, используем localStorage:', error.message);
      this.firebaseAvailable = false;
      return false;
    }
  }

  // Инициализация первоначального админа
  async initializeDefaultAdmin() {
    try {
      const isConnected = await this.checkFirebaseConnection();
      if (!isConnected) {
        // Если Firebase недоступен, создаем админа в localStorage
        this.initializeLocalAdmin();
        return;
      }

      const defaultAdmin = {
        login: 'admin',
        password: this.hashPassword('admin123'),
        name: 'Главный администратор',
        role: 'super_admin',
        createdAt: '2024-01-01T00:00:00.000Z',
        isActive: true
      };

      // Проверяем, есть ли уже главный админ
      const existingSuperAdmin = await this.getAdminByLogin('admin');
      if (!existingSuperAdmin) {
        await this.createAdmin(defaultAdmin);
      }
    } catch (error) {
      console.error('Ошибка инициализации админа:', error);
      // Fallback на localStorage
      this.initializeLocalAdmin();
    }
  }

  // Инициализация админа в localStorage (fallback)
  initializeLocalAdmin() {
    const storedAdmins = localStorage.getItem('survey_admins');
    let admins = storedAdmins ? JSON.parse(storedAdmins) : [];
    
    const existingSuperAdmin = admins.find(admin => admin.role === 'super_admin');
    if (!existingSuperAdmin) {
      const defaultAdmin = {
        id: 'super-admin-001',
        login: 'admin',
        password: this.hashPassword('admin123'),
        name: 'Главный администратор',
        role: 'super_admin',
        createdAt: '2024-01-01T00:00:00.000Z',
        isActive: true
      };
      admins.push(defaultAdmin);
      localStorage.setItem('survey_admins', JSON.stringify(admins));
    }
  }

  // Создание нового администратора
  async createAdmin(adminData) {
    if (!this.firebaseAvailable) {
      throw new Error('Firebase недоступен');
    }

    try {
      const docRef = await addDoc(adminsCol, adminData);
      return {
        success: true,
        admin: { id: docRef.id, ...adminData, password: undefined }
      };
    } catch (error) {
      throw new Error('Ошибка создания администратора: ' + error.message);
    }
  }

  // Получение администратора по логину
  async getAdminByLogin(login) {
    if (!this.firebaseAvailable) {
      // Fallback на localStorage
      const storedAdmins = localStorage.getItem('survey_admins');
      const admins = storedAdmins ? JSON.parse(storedAdmins) : [];
      return admins.find(admin => admin.login === login.toLowerCase());
    }

    try {
      const q = query(adminsCol, where('login', '==', login.toLowerCase()));
      const snapshot = await getDocs(q);
      if (snapshot.empty) return null;
      const docSnap = snapshot.docs[0];
      return { id: docSnap.id, ...docSnap.data() };
    } catch (error) {
      console.error('Ошибка получения админа:', error);
      return null;
    }
  }

  // Получение администратора по ID
  async getAdminById(id) {
    if (!this.firebaseAvailable) {
      const storedAdmins = localStorage.getItem('survey_admins');
      const admins = storedAdmins ? JSON.parse(storedAdmins) : [];
      return admins.find(admin => admin.id === id);
    }

    try {
      const ref = doc(adminsCol, id);
      const snap = await getDoc(ref);
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    } catch (error) {
      console.error('Ошибка получения админа по ID:', error);
      return null;
    }
  }

  // Регистрация нового организатора
  async registerOrganizer(login, password, name, createdBy) {
    try {
      // Проверяем, что создатель - суперадмин
      const creator = await this.getAdminById(createdBy);
      if (!creator || creator.role !== 'super_admin') {
        throw new Error('Только главный администратор может создавать организаторов');
      }

      // Проверка, что логин не занят
      const existingAdmin = await this.getAdminByLogin(login);
      if (existingAdmin) {
        throw new Error('Организатор с таким логином уже существует');
      }

      // Проверка сложности пароля
      if (password.length < 6) {
        throw new Error('Пароль должен содержать минимум 6 символов');
      }

      // Создание нового организатора
      const newOrganizer = {
        login: login.toLowerCase(),
        password: this.hashPassword(password),
        name: name,
        role: 'organizer',
        createdAt: new Date().toISOString(),
        createdBy: createdBy,
        isActive: true
      };

      const result = await this.createAdmin(newOrganizer);
      return result;
    } catch (error) {
      throw new Error('Ошибка регистрации организатора: ' + error.message);
    }
  }

  // Авторизация администратора
  async loginAdmin(login, password) {
    try {
      const admin = await this.getAdminByLogin(login);
      
      if (!admin || !admin.isActive) {
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

      // Сохраняем сессию в localStorage для совместимости
      localStorage.setItem('admin_session', JSON.stringify(session));
      this.currentAdmin = admin;
      
      return {
        success: true,
        admin: { ...admin, password: undefined },
        session
      };
    } catch (error) {
      throw new Error('Ошибка авторизации: ' + error.message);
    }
  }

  // Проверка авторизации администратора
  isAdminLoggedIn() {
    const session = localStorage.getItem('admin_session');
    if (!session) return false;

    try {
      const sessionData = JSON.parse(session);
      return sessionData && sessionData.adminId;
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
      return sessionData ? {
        id: sessionData.adminId,
        login: sessionData.login,
        name: sessionData.name,
        role: sessionData.role
      } : null;
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
    this.currentAdmin = null;
  }

  // Выход администратора (алиас для совместимости)
  logout() {
    this.logoutAdmin();
  }

  // Получение списка всех администраторов
  async getAllAdmins() {
    if (!this.firebaseAvailable) {
      const storedAdmins = localStorage.getItem('survey_admins');
      return storedAdmins ? JSON.parse(storedAdmins) : [];
    }

    try {
      const snapshot = await getDocs(adminsCol);
      return snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data(), 
        password: undefined 
      }));
    } catch (error) {
      throw new Error('Ошибка получения списка администраторов: ' + error.message);
    }
  }

  // Получение списка организаторов
  async getOrganizers() {
    try {
      const currentAdmin = this.getCurrentAdmin();
      if (!currentAdmin || currentAdmin.role !== 'super_admin') {
        throw new Error('Доступ запрещен');
      }

      const allAdmins = await this.getAllAdmins();
      return allAdmins.filter(admin => admin.role === 'organizer');
    } catch (error) {
      throw new Error('Ошибка получения организаторов: ' + error.message);
    }
  }

  // Получение списка организаторов с паролями
  async getOrganizersWithPasswords() {
    try {
      const currentAdmin = this.getCurrentAdmin();
      if (!currentAdmin || currentAdmin.role !== 'super_admin') {
        throw new Error('Доступ запрещен');
      }

      if (!this.firebaseAvailable) {
        const storedAdmins = localStorage.getItem('survey_admins');
        const admins = storedAdmins ? JSON.parse(storedAdmins) : [];
        return admins
          .filter(admin => admin.role === 'organizer')
          .map(admin => ({ 
            ...admin, 
            password: this.dehashPassword(admin.password) 
          }));
      }

      const snapshot = await getDocs(adminsCol);
      return snapshot.docs
        .map(doc => ({ 
          id: doc.id, 
          ...doc.data(),
          password: this.dehashPassword(doc.data().password)
        }))
        .filter(admin => admin.role === 'organizer');
    } catch (error) {
      throw new Error('Ошибка получения организаторов: ' + error.message);
    }
  }

  // Удаление администратора
  async deleteAdmin(adminId) {
    try {
      const currentAdmin = this.getCurrentAdmin();
      if (!currentAdmin || currentAdmin.role !== 'super_admin') {
        throw new Error('Только главный администратор может удалять организаторов');
      }

      if (!this.firebaseAvailable) {
        const storedAdmins = localStorage.getItem('survey_admins');
        let admins = storedAdmins ? JSON.parse(storedAdmins) : [];
        admins = admins.filter(admin => admin.id !== adminId);
        localStorage.setItem('survey_admins', JSON.stringify(admins));
        return { success: true };
      }

      await deleteDoc(doc(adminsCol, adminId));
      return { success: true };
    } catch (error) {
      throw new Error('Ошибка удаления администратора: ' + error.message);
    }
  }

  // Хеширование пароля (простое для демонстрации)
  hashPassword(password) {
    return btoa('survey_salt_2024' + password);
  }

  // Расшифровка пароля
  dehashPassword(hashedPassword) {
    try {
      const decoded = atob(hashedPassword);
      return decoded.replace('survey_salt_2024', '');
    } catch {
      return 'Ошибка расшифровки';
    }
  }

  // Генерация токена
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
const firebaseAdminAuth = new FirebaseAdminAuth();

export default firebaseAdminAuth; 