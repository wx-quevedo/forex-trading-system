<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ExampleTest extends TestCase
{
    use RefreshDatabase;

    public function test_root_redirects_to_dashboard(): void
    {
        $this->get('/')->assertRedirect('/dashboard');
    }

    public function test_guest_is_redirected_to_login(): void
    {
        $this->get('/dashboard')->assertRedirect('/login');
    }

    public function test_login_page_renders(): void
    {
        $this->get('/login')->assertOk();
    }

    public function test_authenticated_user_can_open_dashboard(): void
    {
        // El bridge no está disponible en tests: el dashboard debe renderizar
        // igualmente con bridgeError, sin romper.
        $user = User::factory()->create();

        $this->actingAs($user)->get('/dashboard')->assertOk();
    }
}
