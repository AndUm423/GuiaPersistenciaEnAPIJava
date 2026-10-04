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