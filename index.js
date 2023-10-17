var dropzone = document.getElementById('dropzone');
var dropzoneIcon = document.getElementById('dropzone-icon');
var dropzoneInput = document.getElementById('dropzone-input');
var dropzoneText = document.getElementById('dropzone-text');
var loader = document.getElementById('loader');
var countRows = document.getElementById('count-rows');
var postProcessing = document.getElementById('post-processing');
var downloadButton = document.getElementById('download-button');
var discrepanciesCount = document.getElementById('discrepancies-count');
var discrepanciesTable = document.getElementById('discrepancies-table');
var discrepanciesTableBody = document.getElementById('discrepancies-table-body');

['drag', 'dragstart', 'dragend', 'dragover', 'dragenter', 'dragleave', 'drop'].forEach(function(event) {
  dropzone.addEventListener(event, function(e) {
    e.preventDefault();
    e.stopPropagation();
  });
});

dropzone.addEventListener('dragover', function(e) {
  this.classList.add('dropzone-dragging');
}, false);

dropzone.addEventListener('dragleave', function(e) {
  this.classList.remove('dropzone-dragging');
}, false);

dropzone.addEventListener('drop', function(e) {
  this.classList.remove('dropzone-dragging');
  var file = e.dataTransfer.files[0];
  fileUploaded(file)
}, false);

dropzoneInput.addEventListener('change', (e) => {
  fileUploaded(e.target.files[0])
})

dropzone.addEventListener('click', function(e) {
  dropzoneInput.click();
});

const fileUploaded = (file) => {
  if (file.type === 'text/csv') {
    loader.style.display = 'flex'
    dropzoneText.innerHTML = 'Reading CSV...'
    dropzoneIcon.style.display = 'none'
    setTimeout(() => readFile(file), 500)
  } else {
    alert('Please upload a valid CSV file!')
  }
}

const readFile = (file) => {
  const reader = new FileReader();
  reader.onload = function (event) {
    const csvData = event.target.result;

    const rows = csvData.split('\n');
    const csvArray = [];

    for (let j = 0; j < rows.length; j++) {
      const columns = rows[j].split(',');
      csvArray.push(columns);
    }
    countRows.innerHTML = csvArray.length - 1;
    dropzoneText.innerHTML = `Processing ${csvArray.length - 1} rows of data...`
    setTimeout(() => processCsv(csvArray), 1000)
  }
  reader.readAsText(file);
}

const saveFile = (csvData) => {
  const blob = new Blob([csvData], { type: 'text/csv' });

  const url = window.URL.createObjectURL(blob);

  downloadButton.href = url;
  downloadButton.download = 'generated.csv';

  loader.style.display = 'none';
  dropzoneText.innerHTML = `Upload another file`;
  dropzoneIcon.style.display = 'block';
  postProcessing.style.display = 'block';
  displayDiscrepancies()
}

const displayDiscrepancies = () => {
  discrepanciesCount.innerHTML = discrepancies.length;
  discrepanciesTableBody.innerHTML = '';
  discrepancies.forEach(d => {
    const row = document.createElement('tr');
    for (const cell of Object.keys(d)) {
      const cellData = d[cell];
      const td = document.createElement('td');
      td.textContent = cellData;
      if (cell == 'reason') td.className = cellData;
      row.appendChild(td);
    }
  
    discrepanciesTableBody.appendChild(row);
  })
}