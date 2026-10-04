package com.example.colorapi;

import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseBody;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

@Controller
public class ColorController {

    private static final int MAX_NOMBRE = 50;

    private final Random random = new Random();
    private final SaludoRepository saludoRepository;

    // Spring inyecta el repositorio automáticamente
    public ColorController(SaludoRepository saludoRepository) {
        this.saludoRepository = saludoRepository;
    }

    private String generarColor() {
        return String.format("#%06x", random.nextInt(0xFFFFFF + 1));
    }

    private ResponseEntity<Map<String, String>> error(String detalle) {
        Map<String, String> body = new HashMap<>();
        body.put("detail", detalle);
        return ResponseEntity.badRequest().body(body);
    }

    // GET / → página HTML con el historial guardado
    @GetMapping("/")
    public String home(Model model) {
        model.addAttribute("color", generarColor());
        model.addAttribute("historial", saludoRepository.findTop10ByOrderByIdDesc());
        return "color";
    }

    // GET /color → JSON con un color aleatorio
    @GetMapping("/color")
    @ResponseBody
    public Map<String, String> getColor() {
        Map<String, String> response = new HashMap<>();
        response.put("color", generarColor());
        return response;
    }

    // GET /historial → JSON con los últimos 10 saludos guardados
    @GetMapping("/historial")
    @ResponseBody
    public List<Saludo> historial() {
        return saludoRepository.findTop10ByOrderByIdDesc();
    }

    // POST /saludar → guarda el nombre y el color, y devuelve el saludo
    @PostMapping("/saludar")
    @ResponseBody
    public ResponseEntity<Map<String, String>> saludar(@RequestBody NombreRequest request) {
        String nombre = request.getNombre();

        if (nombre == null || nombre.trim().isEmpty()) {
            return error("El nombre no puede estar vacío");
        }
        nombre = nombre.trim();
        if (nombre.length() > MAX_NOMBRE) {
            return error("El nombre no puede tener más de " + MAX_NOMBRE + " caracteres");
        }

        String color = generarColor();
        saludoRepository.save(new Saludo(nombre, color));   // ← persistencia

        Map<String, String> response = new HashMap<>();
        response.put("saludo", "¡Hola " + nombre + "!");
        response.put("color", color);
        return ResponseEntity.ok(response);
    }
}