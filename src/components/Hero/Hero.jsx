import React from 'react';
import './Hero.css';

const Hero = ({ onOpenModal, onJoinClick }) => {
  return (
    <section className="hero">
      <div className="hero-content">
        <h1>Создавайте опросы легко и быстро</h1>
        <p>Профессиональная платформа для создания интерактивных опросов с мгновенными результатами и детальной аналитикой</p>
        <div className="hero-buttons">
          <a href="#" className="btn-hero btn-hero-primary" onClick={onOpenModal}>
            Создать опрос
          </a>
          <a href="#" className="btn-hero btn-hero-secondary" onClick={e => { e.preventDefault(); onJoinClick && onJoinClick(); }}>
            Принять участие
          </a>
        </div>
      </div>
    </section>
  );
};

export default Hero; 