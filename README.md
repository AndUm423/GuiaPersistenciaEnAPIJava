# Cómo Persistir los Nombres y Colores en PostgreSQL con Spring Boot y Publicarlo en Ubuntu 22

Esta guía es la **continuación** de *"Cómo Servir un Sitio Web con Spring Boot Usando HTML y Thymeleaf"* (proyecto `ColorApiJava`). Parte exactamente del punto donde terminó esa guía: una aplicación que recibe un nombre por `POST /saludar`, devuelve un saludo con un color aleatorio y corre en `https://localhost:8443`.

El problema de esa versión es que **no recuerda nada**: al reiniciar la aplicación (o al recargar la página) los nombres y colores desaparecen.

Al final de esta guía:

- Cada nombre que se ingrese quedará guardado en una base de datos **PostgreSQL**, junto con el **color que se mostró con su saludo** y la fecha.
- La página mostrará los **últimos 10 saludos**, y seguirán ahí después de recargar, reiniciar la aplicación o reiniciar el servidor.
- La aplicación quedará **publicada en un servidor Ubuntu 22** como servicio: arranca sola con el servidor y se reinicia sola si falla.
- Cualquier persona podrá replicar todo con los mismos comandos, en su máquina o en un servidor.

---

## Arquitectura

```text
                         ┌──────────────────────── Servidor Ubuntu 22 ────────────────────────┐
Navegador / Postman ───► │  Spring Boot (JAR)          JDBC            PostgreSQL 16          │
      HTTPS :8443        │  administrado por systemd ─────────────►   (contenedor Docker)     │
                         │                              localhost:5432  datos en volumen      │
                         └────────────────────────────────────────────────────────────────────┘
```

**¿Por qué PostgreSQL y Docker Compose?**

- PostgreSQL es una base de datos libre, robusta y soportada de forma nativa por Spring Boot.
- Docker Compose permite levantar la base de datos con **un solo archivo y un solo comando**, igual en Windows, macOS y Linux. Es lo que hace la guía fácil de replicar.
- Si no puedes o no quieres usar Docker, en el Paso 2 hay una alternativa instalando PostgreSQL directamente.

> Se guarda el color que el servidor devuelve junto con el saludo (el que se muestra en pantalla cuando alguien escribe su nombre y pulsa *Saludar*).

---

## Prerrequisitos

1. Haber completado la guía base: proyecto `ColorApiJava` funcionando con HTTPS en el puerto `8443`, con `ColorController`, `NombreRequest`, `GlobalExceptionHandler`, `color.html`, `style.css` y `script.js`.
2. JDK 25 y Eclipse con Spring Tools (como en la guía base). 
3. **Docker** (Paso 2) o PostgreSQL instalado directamente.
4. Para publicar: servidor Ubuntu 22 con acceso SSH y sudo.

---

## Paso 1: Qué vamos a agregar

| Archivo | Acción | Para qué |
|---|---|---|
| `docker-compose.yml` | Nuevo | Levanta PostgreSQL con datos persistentes |
| `pom.xml` | Modificar | Dependencias JPA y driver de PostgreSQL |
| `application.properties` | Modificar | Conexión a la base de datos |
| `schema.sql` | Nuevo | Crea la tabla `saludos` |
| `Saludo.java` | Nuevo | Entidad: una fila de la tabla |
| `SaludoRepository.java` | Nuevo | Consultas y guardado |
| `ColorController.java` | Modificar | Guarda en cada `POST` y expone `GET /historial` |
| `GlobalExceptionHandler.java` | Modificar | No filtrar detalles internos de la base de datos |
| `color.html`, `style.css`, `script.js` | Modificar | Mostrar el historial |

---

## Paso 2: Instalar Docker (en tu computador de desarrollo)

**Windows / macOS:** instala [Docker Desktop](https://www.docker.com/products/docker-desktop/) y ábrelo una vez para que arranque el motor.

**Ubuntu 22 / Linux:**

```bash
apt install curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Cierra la sesión y vuelve a entrar para que el grupo `docker` tenga efecto. Verifica:

```bash
docker --version
docker compose version
```

### Alternativa sin Docker: PostgreSQL instalado directamente

Si prefieres no usar Docker, instala PostgreSQL y crea el usuario y la base de datos con estos datos (son los mismos que usa el resto de la guía):

```bash
sudo apt update
sudo apt install postgresql -y
sudo -u postgres psql -c "CREATE USER colorapi WITH PASSWORD 'colorapi_dev';"
sudo -u postgres psql -c "CREATE DATABASE colorapi OWNER colorapi;"
```

En Windows, instala PostgreSQL con el instalador oficial y crea el mismo usuario y base de datos desde pgAdmin. Con esta alternativa **omite el Paso 3** y continúa en el Paso 4.

---

## Paso 3: Levantar PostgreSQL con Docker Compose

En la raíz del proyecto (`ColorApiJava/`, junto al `pom.xml`) crea `docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16
    container_name: colorapi-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: colorapi
      POSTGRES_USER: colorapi
      POSTGRES_PASSWORD: ${DB_PASSWORD:-colorapi_dev}
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U colorapi -d colorapi"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
```

Qué hace cada parte importante:

- `image: postgres:16`: versión fija. **No uses `latest`**: a partir de PostgreSQL 18 la imagen oficial cambió la ruta de datos y el volumen de arriba dejaría de persistir.
- `restart: unless-stopped`: el contenedor arranca solo cuando se reinicia el servidor.
- `127.0.0.1:5432:5432`: la base de datos **solo es accesible desde la propia máquina**. Nunca la expongas a Internet.
- `volumes: pgdata`: los datos viven en un volumen de Docker, fuera del contenedor. Por eso sobreviven a que el contenedor se detenga o se recree.
- `${DB_PASSWORD:-colorapi_dev}`: usa la variable `DB_PASSWORD` si existe; si no, usa `colorapi_dev`. En desarrollo no necesitas configurar nada; en el servidor sí lo harás (Paso 14).

Levanta la base de datos:

```bash
docker compose up -d
docker compose ps
```

Cuando la columna de estado diga `healthy`, verifica la conexión:

```bash
docker exec -it colorapi-db psql -U colorapi -d colorapi -c "\conninfo"
```

> Si ya tienes un PostgreSQL local usando el puerto 5432, cambia el mapeo a `"127.0.0.1:5433:5432"` y usa `5433` en la URL del Paso 5.

---

## Paso 4: Agregar las dependencias

Abre `pom.xml` y dentro de `<dependencies>` agrega:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-jpa</artifactId>
</dependency>
<dependency>
    <groupId>org.postgresql</groupId>
    <artifactId>postgresql</artifactId>
    <scope>runtime</scope>
</dependency>
```

No pongas `<version>`: Spring Boot ya administra las versiones compatibles.

En Eclipse: guarda el archivo, clic derecho sobre el proyecto → **Maven → Update Project…** → marca *Force Update of Snapshots/Releases* → **OK**.

**Verifica que Eclipse las cargó:** en el *Package Explorer* despliega **Maven Dependencies** y busca `spring-data-jpa-…jar`, `hibernate-core-…jar` y `postgresql-…jar`. Si no aparecen, revisa la pestaña **Problems** antes de continuar (si no, la aplicación fallará al arrancar con `NoClassDefFoundError`; ver *Solución de problemas*).

- `spring-boot-starter-data-jpa` trae JPA, Hibernate y Spring Data (la capa que habla con la base de datos).
- `postgresql` es el driver JDBC para conectarse a PostgreSQL.

---

## Paso 5: Configurar la conexión

Reemplaza el contenido de `src/main/resources/application.properties`:

```properties
spring.application.name=ColorApiJava

# --- Servidor HTTPS (igual que en la guia base) ---
server.port=8443
server.ssl.key-store=classpath:keystore.p12
server.ssl.key-store-password=${KEYSTORE_PASSWORD:123456}
server.ssl.key-store-type=PKCS12
server.ssl.key-alias=tomcat

# --- Base de datos ---
spring.datasource.url=${DB_URL:jdbc:postgresql://localhost:5432/colorapi}
spring.datasource.username=${DB_USER:colorapi}
spring.datasource.password=${DB_PASSWORD:colorapi_dev}

# La tabla la crea schema.sql (Paso 6), no Hibernate
spring.jpa.hibernate.ddl-auto=none
spring.sql.init.mode=always
spring.jpa.open-in-view=false
```

> **guardado en UTF-8**

> **Sobre HTTPS:** `keystore.p12` debe estar en `src/main/resources/`, y la clave después de `KEYSTORE_PASSWORD:` debe ser la que usaste al crearlo (`estudiantes` en la guía base).

La sintaxis `${NOMBRE:valor}` significa: *"usa la variable de entorno `NOMBRE`; si no existe, usa `valor`"*. Así el **mismo JAR** funciona en tu computador (con los valores por defecto) y en el servidor (con la contraseña real), sin escribir secretos en el código.

- `ddl-auto=none`: Hibernate no toca la estructura de la base. La definimos nosotros en SQL, de forma explícita y controlada.
- `sql.init.mode=always`: Spring ejecuta `schema.sql` en cada arranque contra PostgreSQL.
- `open-in-view=false`: buena práctica; evita que la conexión a la base quede abierta mientras se renderiza la vista.

---

## Paso 6: Crear el esquema de la tabla

Crea `src/main/resources/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS saludos (
    id         BIGSERIAL    PRIMARY KEY,
    nombre     VARCHAR(50)  NOT NULL,
    color      VARCHAR(7)   NOT NULL,
    creado_en  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

- `BIGSERIAL`: identificador autoincremental.
- `VARCHAR(7)`: un color hexadecimal como `#a1b2c3` tiene 7 caracteres.
- `TIMESTAMPTZ`: fecha y hora con zona horaria.
- `IF NOT EXISTS`: el script se puede ejecutar muchas veces sin borrar ni duplicar nada. **Los datos existentes no se tocan.**

---

## Paso 7: La entidad `Saludo`

Una *entidad* es una clase Java que representa una fila de una tabla. Crea `src/main/java/com/example/colorapi/Saludo.java`:

```java
package com.example.colorapi;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "saludos")
public class Saludo {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 50)
    private String nombre;

    @Column(nullable = false, length = 7)
    private String color;

    @Column(name = "creado_en", nullable = false)
    private Instant creadoEn = Instant.now();

    protected Saludo() {
        // Requerido por JPA
    }

    public Saludo(String nombre, String color) {
        this.nombre = nombre;
        this.color = color;
    }

    public Long getId() {
        return id;
    }

    public String getNombre() {
        return nombre;
    }

    public String getColor() {
        return color;
    }

    public Instant getCreadoEn() {
        return creadoEn;
    }
}
```

---

## Paso 8: El repositorio

Crea `src/main/java/com/example/colorapi/SaludoRepository.java`:

```java
package com.example.colorapi;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SaludoRepository extends JpaRepository<Saludo, Long> {

    // Los 10 más recientes: Spring genera el SQL a partir del nombre del método
    List<Saludo> findTop10ByOrderByIdDesc();
}
```

Es solo una **interfaz**: no escribes la implementación. Spring Data genera en tiempo de ejecución `save(...)`, `findAll()`, `count()`, etc., y también la consulta de `findTop10ByOrderByIdDesc()` leyendo su nombre.

---

## Paso 9: Actualizar el controlador

Reemplaza `ColorController.java`. Los endpoints `/`, `/color` y `/saludar` conservan el mismo contrato de la guía base; ahora `/saludar` **guarda** y se agrega `/historial`:

```java
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
```

Observa que el color se genera **una sola vez** y se usa para ambas cosas: se guarda en la base y se devuelve al navegador. Así lo guardado es exactamente lo que la persona vio.

---

## Paso 10: Actualizar el manejo global de errores

Ahora que hay base de datos, un error puede traer en su mensaje detalles internos (consultas SQL, nombres de tablas, hosts). No debemos enviárselos al cliente. Reemplaza `GlobalExceptionHandler.java`:

```java
package com.example.colorapi;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.HashMap;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleGenericException(Exception e) {
        log.error("Error no controlado", e);          // el detalle queda en el log del servidor
        Map<String, String> error = new HashMap<>();
        error.put("detail", "Error interno del servidor");   // el cliente solo ve un mensaje genérico
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
    }
}
```

---

## Paso 11: Actualizar el frontend

### 11.1. `templates/color.html`

Reemplaza el archivo. Agrega la sección del historial (renderizada por Thymeleaf al cargar la página) y hace que el fondo inicial coincida con el color mostrado:

```html
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org">
<head>
    <meta charset="UTF-8">
    <title>Random Color Generator</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body th:style="|background-color: ${color}|">
    <div id="color-code" th:text="${color}">#000000</div>
    <button id="copy-button">Copiar Hex</button>
    <div id="saludo"></div>
    <div>
        <input type="text" id="nombre-input" placeholder="Escribe tu nombre" maxlength="50" required>
        <button id="saludar-button">Saludar</button>
    </div>

    <section class="historial">
        <h2>Últimos saludos</h2>
        <p id="historial-vacio" th:if="${#lists.isEmpty(historial)}">Aún no hay saludos guardados.</p>
        <ul id="historial-lista">
            <li th:each="s : ${historial}">
                <span class="muestra" th:style="|background-color: ${s.color}|"></span>
                <span class="h-nombre" th:text="${s.nombre}">Nombre</span>
                <span class="h-color" th:text="${s.color}">#000000</span>
            </li>
        </ul>
    </section>

    <script src="/script.js"></script>
</body>
</html>
```

Usamos `th:text` (y no `th:utext`) a propósito: Thymeleaf **escapa el HTML**. Como ahora los nombres los escribe cualquier visitante y se muestran a todos, esto evita ataques XSS (por ejemplo, alguien escribiendo `<script>...</script>` como nombre).

### 11.2. `static/style.css`

Reemplaza **todo** el contenido del archivo. Incluye el estilo de la guía base (fondo, fuente `monospace`, texto blanco, tamaños y botones) más el del historial. Si solo agregas las reglas del historial, el resto de la página se verá con el estilo por defecto del navegador.

```css
body {
    min-height: 100vh;
    margin: 0;
    padding: 24px 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    color: white;
    font-family: monospace;
    text-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    transition: background-color 0.3s ease;
    background-color: black;
}

#color-code {
    font-size: clamp(48px, 10vw, 120px);
    margin-bottom: 20px;
}

#saludo {
    font-size: clamp(28px, 6vw, 60px);
    margin: 20px;
    min-height: 70px;
    text-align: center;
}

button, input {
    font-size: 28px;
    padding: 12px 24px;
    margin: 10px;
    border-radius: 12px;
    border: 2px solid rgba(255, 255, 255, 0.6);
    font-family: inherit;
}

button {
    background-color: rgba(0, 0, 0, 0.3);
    color: white;
    cursor: pointer;
    transition: background-color 0.2s ease, transform 0.1s ease;
}

button:hover {
    background-color: rgba(0, 0, 0, 0.5);
}

button:active {
    transform: scale(0.97);
}

input {
    width: min(70vw, 340px);
    background-color: rgba(0, 0, 0, 0.25);
    color: white;
    text-shadow: none;
    outline: none;
}

input:focus {
    border-color: white;
    background-color: rgba(0, 0, 0, 0.4);
}

input::placeholder {
    color: rgba(255, 255, 255, 0.75);
}

/* ---- Historial ---- */
.historial {
    width: min(92%, 640px);
    margin: 30px 0 10px;
}

.historial h2 {
    font-size: clamp(24px, 4vw, 32px);
    text-align: center;
    margin: 10px 0 14px;
}

.historial ul {
    list-style: none;
    padding: 0;
    margin: 0;
}

.historial li {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 16px;
    margin: 8px 0;
    font-size: 22px;
    background-color: rgba(0, 0, 0, 0.25);
    border-radius: 12px;
}

.muestra {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.9);
    flex-shrink: 0;
}

.h-nombre {
    flex: 1;
    overflow-wrap: anywhere;
}

.h-color {
    opacity: 0.8;
}

#historial-vacio {
    text-align: center;
    opacity: 0.85;
}
```

Guarda y recarga con `Ctrl+F5` para saltarte la caché del navegador. Los fondos oscuros translúcidos y la sombra del texto mantienen la lectura aunque el color aleatorio sea claro.

### 11.3. `static/script.js`

Reemplaza el archivo completo. Es el de la guía base más la función `agregarAlHistorial`, que añade el nuevo saludo a la lista sin recargar la página:

```javascript
document.addEventListener('DOMContentLoaded', function() {
    const colorCodeEl = document.getElementById('color-code');
    const saludoEl = document.getElementById('saludo');
    const copyBtn = document.getElementById('copy-button');
    const nombreInput = document.getElementById('nombre-input');
    const saludarBtn = document.getElementById('saludar-button');
    const listaEl = document.getElementById('historial-lista');

    function actualizarColor(color) {
        document.body.style.backgroundColor = color;
        colorCodeEl.textContent = color;
    }

    // Agrega un saludo al inicio del historial (máximo 10 visibles)
    function agregarAlHistorial(nombre, color) {
        const vacio = document.getElementById('historial-vacio');
        if (vacio) vacio.remove();

        const li = document.createElement('li');

        const muestra = document.createElement('span');
        muestra.className = 'muestra';
        muestra.style.backgroundColor = color;

        const nombreEl = document.createElement('span');
        nombreEl.className = 'h-nombre';
        nombreEl.textContent = nombre;      // textContent, nunca innerHTML (evita XSS)

        const colorEl = document.createElement('span');
        colorEl.className = 'h-color';
        colorEl.textContent = color;

        li.append(muestra, nombreEl, colorEl);
        listaEl.prepend(li);

        while (listaEl.children.length > 10) {
            listaEl.lastElementChild.remove();
        }
    }

    // Copiar con fallback
    async function copiarTexto(texto) {
        try {
            await navigator.clipboard.writeText(texto);
            return true;
        } catch (err) {
            const temp = document.createElement('input');
            temp.value = texto;
            document.body.appendChild(temp);
            temp.select();
            temp.setSelectionRange(0, 99999);
            try {
                const success = document.execCommand('copy');
                document.body.removeChild(temp);
                return success;
            } catch (e) {
                document.body.removeChild(temp);
                return false;
            }
        }
    }

    copyBtn.addEventListener('click', async function() {
        const color = colorCodeEl.textContent;
        const ok = await copiarTexto(color);
        if (ok) {
            copyBtn.textContent = '¡Copiado!';
            setTimeout(() => { copyBtn.textContent = 'Copiar Hex'; }, 2000);
        } else {
            alert('No se pudo copiar el código');
        }
    });

    saludarBtn.addEventListener('click', async function() {
        const nombre = nombreInput.value.trim();
        if (nombre === '') {
            alert('Por favor, escribe un nombre');
            return;
        }

        try {
            const response = await fetch('/saludar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre: nombre })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Error al saludar');
            }

            const data = await response.json();
            saludoEl.textContent = data.saludo;
            actualizarColor(data.color);
            agregarAlHistorial(nombre, data.color);
            nombreInput.value = '';
        } catch (error) {
            alert('Hubo un error: ' + error.message);
        }
    });

    nombreInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            saludarBtn.click();
        }
    });
});
```

---

## Paso 12: Probar localmente

Asegúrate de que la base de datos esté arriba (`docker compose ps`) y ejecuta la aplicación: clic derecho en el proyecto → **Run As → Spring Boot App**.

En la consola de Eclipse deberías ver que Hibernate y el pool de conexiones (`HikariPool`) arrancan sin errores.

### 12.1. Desde el navegador

1. Abre `https://localhost:8443/` (acepta el certificado autofirmado, como en la guía base).
2. Escribe un nombre y pulsa **Saludar**. Hazlo con 2 o 3 nombres distintos.
3. Verás cada uno aparecer en **Últimos saludos**, con su color.

### 12.2. Desde la línea de comandos o Postman

```bash
curl -k -X POST https://localhost:8443/saludar \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Ana"}'

curl -k https://localhost:8443/historial
```

> `-k` permite el certificado autofirmado. En Windows PowerShell usa `curl.exe` (el `curl` a secas es otro comando) o Postman, como en el Paso 7 de la guía base.

Respuesta esperada de `/historial`:

```json
[
  {"id": 2, "nombre": "Luis", "color": "#3fa2c1", "creadoEn": "2026-10-02T15:04:11.123456Z"},
  {"id": 1, "nombre": "Ana",  "color": "#d4e5f6", "creadoEn": "2026-10-02T15:03:50.654321Z"}
]
```

### 12.3. Ver los datos directamente en la base

```bash
docker exec -it colorapi-db psql -U colorapi -d colorapi \
  -c "SELECT id, nombre, color, creado_en FROM saludos ORDER BY id DESC LIMIT 10;"
```

> Si prefieres una herramienta gráfica (DBeaver, pgAdmin), conéctate a `localhost:5432`, base `colorapi`, usuario `colorapi`, contraseña `colorapi_dev`.

### 12.4. La prueba que importa: ¿realmente persiste?

1. **Reinicia la aplicación** (detén y vuelve a ejecutar en Eclipse) y recarga la página: el historial sigue ahí.
2. **Reinicia la base de datos:** `docker compose restart db`. Recarga: sigue ahí.
3. **Destruye y recrea el contenedor:** `docker compose down` y luego `docker compose up -d`. Reinicia la aplicación. Sigue ahí, porque los datos viven en el volumen `pgdata`, no en el contenedor.

> ⚠️ `docker compose down -v` (con `-v`) **sí borra el volumen** y, con él, todos los datos. Úsalo solo si quieres empezar desde cero.

---

## Paso 13: Generar el JAR

Desde la raíz del proyecto:

```bash
mvn clean package -DskipTests
```

(Si no tienes Maven instalado, usa el wrapper del proyecto: `./mvnw clean package -DskipTests`, o en Windows PowerShell `.\mvnw.cmd clean package -DskipTests`).

En Eclipse:

Haz clic derecho sobre el proyecto → Run As → Maven build...

En Goals escribe: clean package

Marca Skip Tests si quieres acelerar (opcional).

Haz clic en Run.

Se genera `target/ColorApiJava-0.0.1-SNAPSHOT.jar`.

Usamos `-DskipTests` porque el test que genera Spring (`contextLoads`) arranca toda la aplicación y ahora **necesita una base de datos disponible**; sin ella, el build fallaría.

---

## Paso 14: Publicar en Ubuntu 22

Todo lo siguiente se hace en el **servidor**, salvo los `scp`, que se ejecutan en tu computador.

### 14.1. Preparar el servidor

```bash

# Java (si aún no lo instalaste en la guía base)
sudo apt update
sudo apt install openjdk-25-jre-headless -y
```

Cierra la sesión SSH y vuelve a entrar (para que el grupo `docker` tenga efecto). Verifica con `docker compose version` y `java -version`.

### 14.2. Crear la carpeta de la aplicación y la contraseña

```bash
sudo mkdir -p /opt/colorapi
sudo chown $USER:$USER /opt/colorapi
cd /opt/colorapi

echo "DB_PASSWORD=$(openssl rand -hex 24)" > .env
chmod 600 .env
```

Esto genera una contraseña aleatoria y la guarda en `/opt/colorapi/.env`. **Este archivo es el único lugar donde existe la contraseña de producción**: no lo subas a Git ni lo compartas. Esa misma variable la leerán Docker Compose (para crear la base) y systemd (para arrancar la aplicación).

### 14.3. Copiar los archivos al servidor

Desde **tu computador**, en la raíz del proyecto:

```bash
scp docker-compose.yml usuario@tu-ip:/opt/colorapi/
```
```bash
scp target/ColorApiJava-0.0.1-SNAPSHOT.jar usuario@tu-ip:/opt/colorapi/app.jar
```

### 14.4. Levantar la base de datos en el servidor

```bash
cd /opt/colorapi
# postgreSQL
set -a; source .env; set +a        # carga DB_PASSWORD en esta terminal
echo "$DB_PASSWORD" | wc -c        # debe imprimir un número mayor que 1 (la clave se cargó)

apt update
apt install -y postgresql

pg_lsclusters                      # debe decir "online" en la columna Status

sudo -u postgres psql -c "CREATE USER colorapi WITH PASSWORD '$DB_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE colorapi OWNER colorapi;"
```

Espera a ver `healthy`. La base arrancará sola cada vez que se reinicie el servidor (`restart: unless-stopped`).

> ⚠️ `POSTGRES_PASSWORD` solo se aplica **la primera vez** que se crea el volumen. Si después cambias la contraseña en `.env`, PostgreSQL seguirá usando la anterior (ver *Solución de problemas*).

### 14.5. Crear el servicio systemd

systemd es el administrador de servicios de Ubuntu. Con él la aplicación arranca con el servidor, no depende de tu sesión SSH y se reinicia sola si se cae. (Reemplaza el `nohup ... &` de la guía base.)

Crea un usuario sin privilegios para ejecutar la aplicación:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin colorapi
```

Crea el archivo del servicio:

```bash
sudo nano /etc/systemd/system/colorapi.service
```

Con este contenido:

```ini
[Unit]
Description=ColorApiJava (Spring Boot)
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=colorapi
WorkingDirectory=/opt/colorapi
EnvironmentFile=/opt/colorapi/.env
ExecStart=/usr/bin/java -jar /opt/colorapi/app.jar
SuccessExitStatus=143
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- `EnvironmentFile`: carga `DB_PASSWORD` como variable de entorno, que `application.properties` ya sabe leer.
- `Restart=always` + `RestartSec=5`: si la aplicación se cae, o si al arrancar la base aún no está lista, systemd la vuelve a intentar cada 5 segundos.
- `SuccessExitStatus=143`: Java termina con ese código al apagarse limpiamente; así systemd no lo reporta como fallo.

Actívalo e inícialo:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now colorapi
sudo systemctl status colorapi
```

`enable` = arrancar en cada reinicio del servidor. `--now` = además arrancarlo ya.

Ver el log en vivo (reemplaza el `app.log` de la guía base):

```bash
journalctl -u colorapi -f
```

Sal con `Ctrl+C`. Debes ver que la aplicación inicia y se conecta a la base de datos.

### 14.6. Abrir el puerto de la aplicación (y solo ese)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 8443/tcp
sudo ufw enable
sudo ufw status
```

(Permitir `OpenSSH` **antes** de `enable` evita que te quedes sin acceso por SSH.)

Si tu servidor está en un proveedor de nube (AWS, Azure, GCP, DigitalOcean, etc.), abre también el puerto `8443` TCP en su firewall o *security group*.

Comprueba que la base de datos **no** está expuesta a Internet:

```bash
ss -tlnp | grep 5432
```

Debe aparecer `127.0.0.1:5432`, nunca `0.0.0.0:5432`. (Por eso el `docker-compose.yml` publica el puerto solo en `127.0.0.1`: Docker publica puertos saltándose las reglas de `ufw`.)

### 14.7. Probar desde cualquier computador

Abre `https://tu-ip:8443/` en el navegador (acepta el certificado autofirmado) y prueba:

```bash
curl -k https://tu-ip:8443/historial
```

---

## Paso 15: Comprobar persistencia

Con unos cuantos nombres ya guardados, haz estas tres pruebas en el servidor:

```bash
# 1. Reinicio del servicio
sudo systemctl restart colorapi

# 2. Caída brusca: systemd debe levantarlo de nuevo en ~5 segundos
sudo systemctl kill -s KILL colorapi
sleep 8
sudo systemctl status colorapi

# 3. Reinicio completo del servidor
sudo reboot
```

Después del reinicio (espera uno o dos minutos y vuelve a conectarte), abre la página: la aplicación respondió sola y **todos los nombres siguen en el historial**.

---

## Paso 16: Operación diaria

**Ver logs**

```bash
journalctl -u colorapi -n 100 --no-pager     # aplicación
docker compose -f /opt/colorapi/docker-compose.yml logs --tail 50 db    # base de datos
```

**Hacer una copia de seguridad** (hazlo antes de cualquier cambio importante):

```bash
docker exec colorapi-db pg_dump -U colorapi --clean --if-exists colorapi > /opt/colorapi/backup_$(date +%F).sql
```

**Restaurar una copia**

```bash
sudo systemctl stop colorapi
docker exec -i colorapi-db psql -U colorapi -d colorapi < /opt/colorapi/backup_2026-10-02.sql
sudo systemctl start colorapi
```

**Publicar una nueva versión de la aplicación** (los datos no se tocan):

```bash
# En tu computador
mvn clean package -DskipTests
scp target/ColorApiJava-0.0.1-SNAPSHOT.jar usuario@tu-ip:/opt/colorapi/app.jar

# En el servidor
sudo systemctl restart colorapi
```

**Consultar la base desde tu computador sin abrir el puerto 5432:** usa un túnel SSH y conecta tu herramienta gráfica a `localhost:5432`:

```bash
ssh -L 5432:localhost:5432 usuario@tu-ip
```

---

## Estructura final del proyecto

```text
ColorApiJava/
├── docker-compose.yml                       ← NUEVO
├── pom.xml                                  ← MODIFICADO (JPA + PostgreSQL)
├── src/
│   └── main/
│       ├── java/com/example/colorapi/
│       │   ├── ColorApiJavaApplication.java
│       │   ├── ColorController.java         ← MODIFICADO
│       │   ├── NombreRequest.java
│       │   ├── GlobalExceptionHandler.java  ← MODIFICADO
│       │   ├── Saludo.java                  ← NUEVO
│       │   └── SaludoRepository.java        ← NUEVO
│       └── resources/
│           ├── static/
│           │   ├── style.css                ← MODIFICADO
│           │   └── script.js                ← MODIFICADO
│           ├── templates/
│           │   └── color.html               ← MODIFICADO
│           ├── application.properties       ← MODIFICADO
│           ├── schema.sql                   ← NUEVO
│           └── keystore.p12
```

Y en el servidor:

```text
/opt/colorapi/
├── app.jar
├── docker-compose.yml
└── .env                                     ← contraseña (permisos 600)
/etc/systemd/system/colorapi.service
```

---

## Resumen de Endpoints

| Método | URL | Descripción | Cuerpo (POST) | Respuesta |
|---|---|---|---|---|
| GET | `/` | Página HTML con el historial guardado | - | HTML |
| GET | `/color` | Color aleatorio en JSON (no se guarda) | - | `{"color":"#a1b2c3"}` |
| GET | `/historial` | Últimos 10 saludos guardados | - | `[{"id":1,"nombre":"Ana","color":"#d4e5f6","creadoEn":"..."}]` |
| POST | `/saludar` | Guarda el nombre y su color; devuelve saludo + color | `{"nombre":"Ana"}` | `{"saludo":"¡Hola Ana!","color":"#d4e5f6"}` |

---

## Solución de Problemas Comunes

**`NoClassDefFoundError` / `ClassNotFoundException: org.springframework.data.jpa.repository.JpaRepository` al arrancar desde Eclipse**
Eclipse no cargó las dependencias nuevas del `pom.xml`; no es un error de tu código. Soluciones, en orden:
1. Verifica que las dependencias estén dentro de `<dependencies>` y guarda el `pom.xml`.
2. Clic derecho sobre el proyecto → **Maven → Update Project…** (`Alt+F5`) con *Force Update* marcado.
3. Comprueba que en **Maven Dependencies** aparezcan `spring-data-jpa`, `hibernate-core` y `postgresql`. Si no, mira la pestaña **Problems** (suele ser un error de descarga).
4. **Project → Clean…** y ejecuta de nuevo.
5. Si persiste, prueba `mvn clean compile` en una terminal. Si funciona ahí, el problema es la caché de Eclipse. Si el proyecto está dentro de OneDrive, pausa la sincronización: puede bloquear la carpeta `target/`.

**El log dice `Tomcat initialized with port 8080 (http)` en lugar de `8443 (https)`**
El `application.properties` del Paso 5 no se está aplicando. Verifica que lo reemplazaste y guardaste, que está en `src/main/resources/` y que `keystore.p12` está en esa misma carpeta; luego haz **Project → Clean…**. Si nunca configuraste HTTPS en la guía base, usa la variante sin HTTPS del Paso 5. Mientras ese archivo no tenga la sección de base de datos, la aplicación fallará con `Failed to configure a DataSource: 'url' attribute is not specified`.

**`MalformedInputException: Input length = 1` al copiar `application.properties` (o `unmappable character ... for encoding UTF-8`)**
El archivo contiene caracteres (tildes, `ñ`, `¡`) guardados en una codificación distinta de UTF-8, normalmente Windows-1252, que es la predeterminada de Eclipse en Windows. Maven exige UTF-8 y falla; Eclipse deja entonces una copia vieja en `target/classes/` y la aplicación arranca en el puerto 8080 sin la configuración nueva. Solución:
1. En `application.properties` quita todas las tildes y `ñ`, incluso en los comentarios.
2. Para el resto del proyecto, ve a **Window → Preferences → General → Workspace**, pon **Text file encoding → Other: UTF-8** y aplica. Haz lo mismo en **clic derecho sobre el proyecto → Properties → Resource**.
3. Los archivos que ya estaban guardados en la codificación anterior mostrarán símbolos raros (�): reescribe esas palabras o vuelve a pegar el contenido de la guía, y guarda.

**Edité `application.properties` pero el log sigue igual (puerto 8080, sin URL de base de datos)**
Eclipse no ejecuta `src/main/resources` sino la copia en `target/classes/` (la ruta aparece en la primera línea del log). Esa copia está desactualizada, o el archivo que editaste no es el del classpath. Revisa:
1. Abre `target/classes/application.properties`: si solo tiene `spring.application.name`, la copia es vieja.
2. Con `Ctrl+Shift+R` busca `application`: debe existir un único `application.properties`, en `src/main/resources/` (comprueba que no termine en `.txt` ni esté duplicado en otra carpeta).
3. Activa **Project → Build Automatically**, luego **Project → Clean…** y `F5` sobre el proyecto.
4. Prueba desde una terminal en la carpeta del proyecto: `.\mvnw.cmd clean spring-boot:run` (Windows PowerShell; el `.\` es obligatorio) o `./mvnw clean spring-boot:run` (Linux/macOS). Si ahí funciona, el problema es la caché de Eclipse; si falla con `MalformedInputException`, es el problema de codificación descrito en la entrada anterior.
5. Si el proyecto está dentro de OneDrive, muévelo a una ruta simple fuera de él (por ejemplo `C:\dev\ColorApiJava`) e impórtalo con *File → Import → Existing Maven Projects*.

**`Connection refused` o `Unable to determine Dialect` al arrancar**
La base de datos no está arriba o no es alcanzable. Revisa `docker compose ps` (debe decir `healthy`) y que la URL sea `jdbc:postgresql://localhost:5432/colorapi`.

**`password authentication failed for user "colorapi"`**
La contraseña que usa la aplicación no coincide con la que tiene PostgreSQL. `POSTGRES_PASSWORD` solo se aplica al crear el volumen por primera vez. Dos soluciones:
- Cambiar la contraseña dentro de la base sin perder datos:
  ```bash
  docker exec -it colorapi-db psql -U colorapi -d colorapi -c "ALTER USER colorapi WITH PASSWORD 'LA_QUE_ESTA_EN_.env';"
  ```
- Si todavía no hay datos importantes: `docker compose down -v` y `docker compose up -d` para recrear todo desde cero.

**`relation "saludos" does not exist`**
No se ejecutó `schema.sql`. Verifica que esté en `src/main/resources/` (no en `static/`) y que `application.properties` tenga `spring.sql.init.mode=always`.

**`mvn clean package` falla en los tests con errores de conexión**
Usa `-DskipTests` (Paso 13) o deja la base de datos arriba mientras compilas.

**El puerto 5432 ya está en uso**
Tienes otro PostgreSQL local. Cambia el mapeo en `docker-compose.yml` a `"127.0.0.1:5433:5432"` y define `DB_URL=jdbc:postgresql://localhost:5433/colorapi`.

**Los datos desaparecieron después de reiniciar**
Causas típicas: se ejecutó `docker compose down -v`, se cambió a la imagen `postgres:latest` (rutas de datos distintas desde la versión 18) o se quitó el bloque `volumes` del `docker-compose.yml`. Lista los volúmenes con `docker volume ls`.

**La aplicación funciona en Eclipse pero no en el servidor**
Mira `journalctl -u colorapi -n 100 --no-pager`. Casi siempre es una de estas: la base aún no estaba lista (systemd reintenta solo), falta el archivo `/opt/colorapi/.env`, o `DB_PASSWORD` no coincide con la de la base.

**El historial no muestra los colores o los nombres nuevos hasta recargar**
Limpia la caché del navegador (`Ctrl+F5`): el navegador puede estar usando una versión antigua de `script.js`.

**`Hubo un error: Error interno del servidor`**
Es el mensaje genérico del Paso 10. El detalle real está en el log: `journalctl -u colorapi -n 100 --no-pager` en el servidor, o la consola de Eclipse en local.

---

## Notas de seguridad

- **La base de datos solo escucha en `127.0.0.1`.** Nunca publiques el puerto 5432 en Internet.
- **Ninguna contraseña está en el código.** Viven en `.env` (permisos `600`, fuera de Git). Si usas Git, agrega `.env` a tu `.gitignore`.
- **Los nombres que escribe la gente se muestran a todos.** Por eso se usa `th:text` y `textContent` (nunca `th:utext` ni `innerHTML`), para impedir que alguien inyecte código en la página.
- **El endpoint `POST /saludar` es público y acepta escrituras anónimas.** Si la publicas abiertamente, cualquiera podría llenar tu tabla de basura. Para un uso más allá de un ejercicio, considera limitar la frecuencia de peticiones o agregar moderación.
- **El certificado es autofirmado**, así que los navegadores mostrarán una advertencia. Es suficiente para aprender y probar.

---

## Siguientes pasos

1. **Dominio y certificado real:** apunta un dominio a tu servidor y usa un proxy inverso (Caddy o Nginx) con Let's Encrypt para tener HTTPS sin advertencias en el puerto 443.
2. **Migraciones con Flyway:** cuando la tabla evolucione (nuevas columnas), reemplaza `schema.sql` por migraciones versionadas.
3. **DTOs y paginación:** devuelve objetos propios en lugar de la entidad y agrega `?pagina=` al historial.
4. **Pruebas con Testcontainers:** levantan un PostgreSQL temporal durante los tests, sin necesidad de `-DskipTests`.
5. **Todo en contenedores:** agrega un `Dockerfile` para la aplicación y súmala al `docker-compose.yml`, para desplegar todo con un único `docker compose up -d`.

Seguimiento despliegue en servidor: https://docs.google.com/document/d/1_G3nVS2N5WhuONHr1PaE59Y5jMzOFT_9mbndFBebILU/edit?usp=sharing 
