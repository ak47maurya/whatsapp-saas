function toggleSidebar() {
  document.querySelector('.sidebar')?.classList.toggle('show');
}

$(document).ready(function () {
  $('.datatable').each(function() {
    const order = $(this).data('order');
    $(this).DataTable({
      pageLength: 25,
      responsive: true,
      order: order || [[0, 'asc']],
      language: { search: '', searchPlaceholder: 'Search...' },
      dom: '<"row"<"col-sm-12 col-md-6"l><"col-sm-12 col-md-6"f>>rtip',
    });
  });

  $('.alert-dismissible').delay(5000).fadeOut(500);

  if (typeof io !== 'undefined') {
    const token = document.cookie.split('; ').find(r => r.startsWith('token='))?.split('=')[1];
    if (token) {
      const socket = io({ auth: { token } });
      socket.on('connect', () => console.log('Socket connected'));
      socket.on('notification:new', (data) => {
        const badge = document.querySelector('.notify-badge');
        if (badge) {
          const count = parseInt(badge.textContent) || 0;
          badge.textContent = count + 1;
          badge.style.display = 'inline';
        }
        if (typeof Swal !== 'undefined') {
          Swal.fire({ title: data.title, text: data.message, icon: data.type, timer: 5000, toast: true, position: 'top-end', showConfirmButton: false });
        }
      });
    }
  }

  $('form[data-confirm]').on('submit', function (e) {
    e.preventDefault();
    const form = this;
    Swal.fire({
      title: 'Are you sure?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes',
    }).then((result) => {
      if (result.isConfirmed) form.submit();
    });
  });
});
