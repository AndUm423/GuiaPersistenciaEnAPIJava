package com.example.colorapi;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SaludoRepository extends JpaRepository<Saludo, Long> {

    // Los 10 más recientes: Spring genera el SQL a partir del nombre del método
    List<Saludo> findTop10ByOrderByIdDesc();
}