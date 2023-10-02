var dropzone = document.getElementById('dropzone');
var dropzone_input = document.getElementById('dropzone-input');

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
  if (file.type === 'text/csv') {
    readFile(file)
  } else {
    alert('Please upload a valid CSV file!')
  }

  
}, false);

dropzone.addEventListener('click', function(e) {
  dropzone_input.click();
});

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

    console.log(csvArray);
  }
  reader.readAsText(file);
}